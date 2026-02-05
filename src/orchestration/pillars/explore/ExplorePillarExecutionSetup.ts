import type { ParsedIntent } from "../../IntentRouter.js";
import type { OrchestrationContext } from "../../OrchestrationContext.js";
import type { InternalToolRegistry } from "../../InternalToolRegistry.js";
import type { RepoRegistry } from "../../../config/RepoRegistry.js";
import type { PathNormalizer } from "../../../utils/PathNormalizer.js";
import type { FlowArtifactManager } from "../../flow-artifact-manager.js";
import type { OptionSource, TraceOptionResolution } from "../../../types/option-trace.js";
import type { ToolProfile } from "../../options/OptionResolver.js";
import type { QueryMetrics } from "../../../engine/search/QueryMetrics.js";
import type { ExploreInput } from "./ExploreInputNormalizer.js";
import { BudgetManager } from "../../BudgetManager.js";
import { analyzeQuery } from "../../../engine/search/QueryMetrics.js";
import { TraceBuilder } from "../../trace/TraceBuilder.js";
import { buildBudgetPlan, getSectionPlan } from "../../budget/TokenBudgetAllocatorV2.js";
import { FeatureFlags } from "../../../config/FeatureFlags.js";
import { AdaptiveLodController } from "../../adaptive-flow/AdaptiveLodController.js";
import {
    computeAdaptiveFlowGate,
    recordAdaptiveFlowGateTrace,
    resolveRolloutPresetFromEnv,
    setAdaptiveFlowGate
} from "../../adaptive-flow/AdaptiveFlowGate.js";
import { normalizeExploreInput } from "./ExploreInputNormalizer.js";
import { computeExplorePackId } from "./EvidencePackBuilder.js";
import {
    DEFAULT_MAX_RESULTS,
    DEFAULT_MAX_CHARS,
    DEFAULT_MAX_FULL_CHARS,
    DEFAULT_MAX_FILES
} from "./ExplorePillarDefaults.js";

export interface ExploreExecutionSetup {
    input: ExploreInput;
    repoRegistry?: RepoRegistry;
    pathNormalizer?: PathNormalizer;
    artifactManager?: FlowArtifactManager;
    view: ExploreInput["view"];
    profile?: ToolProfile;
    adaptiveDecision?: ReturnType<AdaptiveLodController["resolveProfile"]>;
    queryMetrics?: QueryMetrics;
    queryTokens: string[];
    symbolQuery: boolean;
    timeoutMs?: number;
    hasDeadline: boolean;
    timeRemaining: () => number;
    projectStats?: any;
    searchBudget?: BudgetManager;
    traceBuilder?: TraceBuilder;
    budgetPlan: ReturnType<typeof buildBudgetPlan>;
    docSectionStrategy: "raw" | "preview" | "summary" | "distill" | "truncate";
    docSectionMaxChars: number;
    allowDocSectionExpand: boolean;
    researchOmitted: boolean;
    maxResults: number;
    maxChars: number;
    maxTokens?: number;
    maxItemChars: number;
    maxItemTokens?: number;
    maxBytes?: number;
    maxFiles: number;
    includeDocs: boolean;
    includeCode: boolean;
    includeComments: boolean;
    includeLogs: boolean;
    docHint: boolean;
    effectivePackId?: string;
    adaptiveLod?: AdaptiveLodController;
}

const resolveOptionSource = (explicit: boolean, hasSession: boolean): OptionSource => {
    if (explicit) return "explicit";
    if (hasSession) return "session";
    return "default";
};

const buildStringResolution = (
    resolved: string | undefined,
    explicit: boolean,
    hasSession: boolean,
    requested?: unknown
): TraceOptionResolution<string | null> => ({
    source: resolveOptionSource(explicit, hasSession),
    explicit,
    resolved: resolved ?? null,
    ...(requested !== undefined ? { requested } : {})
});

export async function initializeExploreExecution(args: {
    intent: ParsedIntent;
    context: OrchestrationContext;
    registry: InternalToolRegistry;
    startedAt: number;
    runTool: (context: OrchestrationContext, tool: string, args: any) => Promise<any>;
    isSymbolLikeQuery: (metrics: QueryMetrics, tokens: string[]) => boolean;
}): Promise<ExploreExecutionSetup> {
    const { intent, context, registry, startedAt, runTool, isSymbolLikeQuery } = args;
    const repoRegistry = registry.getMetadata<RepoRegistry>("repoRegistry");
    const pathNormalizer = registry.getMetadata<PathNormalizer>("pathNormalizer");
    const artifactManager = registry.getMetadata<FlowArtifactManager>("flowArtifactManager");
    const input = normalizeExploreInput(intent, {
        resolveSessionId: (rawSessionId, fallback) => artifactManager?.resolveSessionId(rawSessionId, fallback),
        getSessionPolicy: (sessionId) => (sessionId ? artifactManager?.getSession(sessionId)?.policy : undefined)
    });
    let view = input.view;
    let profile: ToolProfile | undefined = input.profile as ToolProfile | undefined;
    const adaptiveLod = registry.getMetadata<AdaptiveLodController>("adaptiveLodController");
    const profileExplicit = typeof input.constraints.profile === "string";
    const adaptiveDecision = adaptiveLod?.resolveProfile({
        sessionId: input.resolvedSessionId,
        tool: "explore",
        requestedProfile: (profile ?? "balanced") as ToolProfile,
        explicit: profileExplicit
    });
    if (adaptiveDecision?.downshifted) {
        profile = adaptiveDecision.profile;
        applyExploreProfileCaps(input.limits, profile);
        if (!profileExplicit && typeof input.constraints.view !== "string") {
            view = profile === "lean" || profile === "fast" ? "preview" : view;
        }
    }
    input.resolvedOptions.effective.profile = profile;

    const queryMetrics = input.query ? analyzeQuery(input.query) : undefined;
    const queryTokens = input.query ? input.query.trim().split(/\s+/).filter(Boolean) : [];
    const symbolQuery = queryMetrics ? isSymbolLikeQuery(queryMetrics, queryTokens) : false;
    const timeoutMs = Number.isFinite(input.limits.timeoutMs) && input.limits.timeoutMs! > 0
        ? input.limits.timeoutMs!
        : Number.parseInt(process.env.KAIRO_EXPLORE_TIMEOUT_MS ?? "", 10) || undefined;
    const hasDeadline = Number.isFinite(timeoutMs) && timeoutMs! > 0;
    const timeRemaining = () => hasDeadline
        ? Math.max(0, timeoutMs! - (Date.now() - startedAt))
        : Number.POSITIVE_INFINITY;

    let projectStats = context.getState<any>("project_profile");
    if (!projectStats) {
        try {
            projectStats = await runTool(context, "project_profile", {});
            if (projectStats) {
                context.setState("project_profile", projectStats);
            }
        } catch {
            projectStats = undefined;
        }
    }

    const searchBudget = queryMetrics
        ? BudgetManager.create({
            category: "navigate",
            queryLength: queryMetrics.length,
            tokenCount: queryMetrics.tokenCount,
            strongQuery: queryMetrics.strong,
            projectStats: projectStats?.fileCount ? { fileCount: projectStats.fileCount } : undefined
        })
        : undefined;
    if (searchBudget && hasDeadline) {
        searchBudget.maxParseTimeMs = Math.min(searchBudget.maxParseTimeMs, timeoutMs!);
    }

    const maxResults = Number.isFinite(input.limits.maxResults) && input.limits.maxResults! > 0 ? input.limits.maxResults! : DEFAULT_MAX_RESULTS;
    const maxChars = Number.isFinite(input.limits.maxChars) && input.limits.maxChars! > 0
        ? input.limits.maxChars!
        : (view === "full" ? DEFAULT_MAX_FULL_CHARS : DEFAULT_MAX_CHARS);
    const envMaxTokens = Number.parseInt(process.env.KAIRO_EXPLORE_MAX_TOKENS ?? process.env.KAIRO_DEFAULT_MAX_TOKENS ?? "", 10);
    const maxTokens = Number.isFinite(input.limits.maxTokens) && input.limits.maxTokens! > 0
        ? input.limits.maxTokens!
        : (Number.isFinite(envMaxTokens) && envMaxTokens > 0 ? envMaxTokens : undefined);
    const maxItemChars = Number.isFinite(input.limits.maxItemChars) && input.limits.maxItemChars! > 0
        ? input.limits.maxItemChars!
        : Math.max(400, Math.floor(maxChars / Math.max(1, maxResults)));
    const maxItemTokens = maxTokens ? Math.max(128, Math.floor(maxTokens / Math.max(1, maxResults))) : undefined;
    const maxBytes = Number.isFinite(input.limits.maxBytes) && input.limits.maxBytes! > 0
        ? input.limits.maxBytes!
        : Number.parseInt(process.env.KAIRO_READ_FILE_MAX_BYTES ?? "0", 10) || undefined;
    const maxFiles = Number.isFinite(input.limits.maxFiles) && input.limits.maxFiles! > 0 ? input.limits.maxFiles! : DEFAULT_MAX_FILES;
    const includeDocs = input.include.docs !== false;
    const includeCode = input.include.code !== false;
    const includeComments = input.include.comments === true;
    const includeLogs = input.include.logs === true;
    const docHint = includeDocs && !includeCode;

    const sessionProfile = input.sessionPolicy?.explore?.profile ?? input.sessionPolicy?.profile;
    const sessionSources = input.sessionPolicy?.explore?.sources ?? input.sessionPolicy?.sources;
    const traceBuilder = input.traceEnabled
        ? new TraceBuilder(
            "explore",
            {
                profile: buildStringResolution(
                    profile,
                    typeof input.constraints.profile === "string",
                    Boolean(sessionProfile),
                    typeof input.constraints.profile === "string" ? input.constraints.profile : undefined
                ),
                sources: buildStringResolution(
                    input.resolvedOptions.effective.sources,
                    typeof input.constraints.sources === "string",
                    Boolean(sessionSources),
                    typeof input.constraints.sources === "string" ? input.constraints.sources : undefined
                ),
                trace: {
                    source: input.constraints.trace === true ? "explicit" : "default",
                    explicit: input.constraints.trace === true,
                    resolved: input.traceEnabled
                }
            },
            { startedAtMs: startedAt }
        )
        : undefined;

    if (traceBuilder) {
        traceBuilder.setBudget({ maxTokens, maxChars, timeoutMs });
    }
    if (traceBuilder && adaptiveDecision?.downshifted) {
        traceBuilder.recordEvent({
            area: "budget",
            code: "adaptive_lod.downshift",
            data: {
                from: input.resolvedOptions.effective.profile ?? "balanced",
                to: profile,
                violationStreak: adaptiveDecision.violationStreak,
                stableScore: adaptiveDecision.stableScore,
                cooldownRemaining: adaptiveDecision.cooldownRemaining,
                reasonCodes: adaptiveDecision.reasonCodes
            }
        });
    }
    const gate = computeAdaptiveFlowGate({
        profile,
        fileCount: typeof projectStats?.fileCount === "number" ? projectStats.fileCount : undefined
    });
    setAdaptiveFlowGate(context, gate);
    if (traceBuilder) {
        recordAdaptiveFlowGateTrace(traceBuilder, gate, {
            rolloutMode: resolveRolloutPresetFromEnv() ?? FeatureFlags.getMode(FeatureFlags.ADAPTIVE_FLOW_ENABLED),
            userIdResolved: Boolean(FeatureFlags.getContext()?.userId)
        });
    }

    const budgetPlan = buildBudgetPlan({
        pillar: "explore",
        profile: (profile ?? "balanced") as ToolProfile,
        sources: input.resolvedOptions.effective.sources,
        maxTokens,
        maxChars,
        timeoutMs,
        include: input.include,
        view
    });
    const docSectionPlan = getSectionPlan(budgetPlan, "doc_sections");
    const docSectionStrategy = (docSectionPlan?.strategy ?? "raw") as ExploreExecutionSetup["docSectionStrategy"];
    const docSectionMaxChars = Math.min(
        maxChars,
        resolveSectionChars(docSectionPlan, maxChars)
    );
    const allowDocSectionExpand = docSectionPlan?.strategy !== "omit";
    const researchPlan = getSectionPlan(budgetPlan, "research_pack");
    const researchOmitted = researchPlan?.strategy === "omit";
    if (traceBuilder) {
        traceBuilder.recordEvent({
            area: "budget",
            code: "allocator.plan_created",
            data: {
                maxTokens: budgetPlan.maxTokens,
                maxChars: budgetPlan.maxChars,
                sectionCount: budgetPlan.sections.length
            }
        });
        for (const section of budgetPlan.sections) {
            traceBuilder.recordEvent({
                area: "budget",
                code: "allocator.section_strategy",
                data: {
                    section: section.section,
                    strategy: section.strategy,
                    tokens: section.tokens,
                    chars: section.chars
                }
            });
            if (section.strategy === "omit") {
                traceBuilder.recordSkip(section.section, "budget_exceeded", "allocator omitted section");
            }
        }
    }

    if (searchBudget) {
        const desiredFileBudget = Math.min(
            maxFiles,
            Math.max(12, maxResults * 2)
        );
        searchBudget.maxCandidates = Math.min(searchBudget.maxCandidates, desiredFileBudget);
        searchBudget.maxFilesRead = Math.min(searchBudget.maxFilesRead, desiredFileBudget);
        const perFileCharBudget = Math.max(400, Math.floor(maxChars / Math.max(1, maxResults)));
        searchBudget.maxBytesRead = Math.min(
            searchBudget.maxBytesRead,
            desiredFileBudget * perFileCharBudget
        );
    }

    const packOptions: Record<string, unknown> = {
        include: { docs: includeDocs, code: includeCode, comments: includeComments, logs: includeLogs },
        intent: input.constraints.intent,
        paths: input.paths
    };
    const profileAffectsPack = input.resolvedOptions.meta.profileAffectsPack || Boolean(adaptiveDecision?.downshifted);
    if (profileAffectsPack && profile) {
        packOptions.profile = profile;
    }
    if (input.resolvedOptions.meta.sourcesAffectsPack && input.resolvedOptions.effective.sources) {
        packOptions.sources = input.resolvedOptions.effective.sources;
    }
    const effectivePackId = input.query
        ? (input.packId ?? computeExplorePackId(input.query, packOptions))
        : undefined;

    if (input.resolvedSessionId) {
        const policyPatch: Partial<{ profile?: string; sources?: string; explore?: Record<string, unknown> }> = {};
        if (typeof input.constraints.profile === "string") {
            policyPatch.profile = input.constraints.profile;
            policyPatch.explore = { ...(policyPatch.explore ?? {}), profile: input.constraints.profile };
        }
        if (typeof input.constraints.sources === "string") {
            policyPatch.sources = input.constraints.sources;
            policyPatch.explore = { ...(policyPatch.explore ?? {}), sources: input.constraints.sources };
        }
        if (Object.keys(policyPatch).length > 0) {
            artifactManager?.updateSessionPolicy(input.resolvedSessionId, policyPatch as any, "merge");
        }
    }

    return {
        input,
        repoRegistry,
        pathNormalizer,
        artifactManager,
        view,
        profile,
        adaptiveDecision,
        queryMetrics,
        queryTokens,
        symbolQuery,
        timeoutMs,
        hasDeadline,
        timeRemaining,
        projectStats,
        searchBudget,
        traceBuilder,
        budgetPlan,
        docSectionStrategy,
        docSectionMaxChars,
        allowDocSectionExpand,
        researchOmitted,
        maxResults,
        maxChars,
        maxTokens,
        maxItemChars,
        maxItemTokens,
        maxBytes,
        maxFiles,
        includeDocs,
        includeCode,
        includeComments,
        includeLogs,
        docHint,
        effectivePackId,
        adaptiveLod
    };
}

function applyExploreProfileCaps(limits: {
    maxResults?: number;
    maxChars?: number;
    maxTokens?: number;
    maxItemChars?: number;
    maxBytes?: number;
    maxFiles?: number;
}, profile: string): void {
    if (profile === "lean") {
        limits.maxResults = clampToMax(limits.maxResults, 20);
        limits.maxFiles = clampToMax(limits.maxFiles, 400);
        limits.maxItemChars = clampToMax(limits.maxItemChars, 2400);
        limits.maxChars = clampToMax(limits.maxChars, 20000);
        limits.maxTokens = clampToMax(limits.maxTokens, 1500);
        limits.maxBytes = clampToMax(limits.maxBytes, 400000);
    }
    if (profile === "fast") {
        limits.maxResults = clampToMax(limits.maxResults, 5);
        limits.maxFiles = clampToMax(limits.maxFiles, 80);
        limits.maxChars = clampToMax(limits.maxChars, 6000);
    }
    if (profile === "deep") {
        limits.maxResults = clampToMax(limits.maxResults, 12);
        limits.maxFiles = clampToMax(limits.maxFiles, 300);
        limits.maxChars = clampToMax(limits.maxChars, 12000);
    }
}

function clampToMax(value: number | undefined, maxValue: number): number {
    if (!Number.isFinite(value)) return maxValue;
    return Math.min(value as number, maxValue);
}

function resolveSectionChars(plan: { chars?: number; tokens?: number } | undefined, fallback: number): number {
    if (!plan) return fallback;
    if (Number.isFinite(plan.chars) && (plan.chars ?? 0) > 0) {
        return Math.max(64, plan.chars ?? fallback);
    }
    if (Number.isFinite(plan.tokens) && (plan.tokens ?? 0) > 0) {
        return Math.max(64, Math.floor((plan.tokens ?? 0) * 4));
    }
    return fallback;
}
