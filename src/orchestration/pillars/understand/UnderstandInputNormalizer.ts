import type { ParsedIntent } from "../../IntentRouter.js";
import { IntegrityEngine } from "../../../integrity/IntegrityEngine.js";
import { OptionResolver } from "../../options/OptionResolver.js";
import { resolveEnvelopeMaxTokens, resolveMcpMode, resolveTimeboxPolicy } from "../../policy/McpModePresetRegistry.js";

export type UnderstandInput = {
    constraints: any;
    subject: string;
    rawSessionId?: string;
    resolvedSessionId?: string;
    sessionPolicy?: any;
    resolvedOptions: ReturnType<typeof OptionResolver.resolveUnderstandOptions>;
    depth: string;
    include: Record<string, any>;
    traceEnabled: boolean;
    vibe?: { extract?: boolean; scope?: string; includeNorms?: boolean };
    wantsVibe: boolean;
    analysis?: { clusters?: boolean; maxClusters?: number; maxFilesPerCluster?: number };
    wantsAnalysis: boolean;
    includeClusters: boolean;
    clusterOptions?: { maxClusters?: number; expansionDepth?: number; includePreview?: boolean };
    includeDependencies: boolean;
    includeCalls: boolean;
    explicitPath?: string | null;
    symbolHint?: string | null;
    integrityOptions: ReturnType<typeof IntegrityEngine.resolveOptions>;
    limits: {
        maxTokens?: number;
        maxChars?: number;
        timeoutMs?: number;
    };
    maxTokens?: number;
};

export function normalizeUnderstandInput(
    intent: ParsedIntent,
    helpers: {
        resolveSessionId: (rawSessionId: string | undefined, fallback: string) => string | undefined;
        getSessionPolicy: (sessionId: string | undefined) => any;
        extractPath: (value: string | undefined | null) => string | null;
        extractSymbol: (value: string | undefined | null) => string | null;
    }
): UnderstandInput {
    const { targets, constraints, originalIntent } = intent;
    const subject = (constraints.goal || targets[0] || originalIntent || "") as string;
    const rawSessionId = typeof constraints.sessionId === "string" ? constraints.sessionId : undefined;
    const resolvedSessionId = helpers.resolveSessionId(rawSessionId, subject);
    const sessionPolicy = helpers.getSessionPolicy(resolvedSessionId);
    const resolvedOptions = OptionResolver.resolveUnderstandOptions(constraints, sessionPolicy);
    const depth = resolvedOptions.effective.depth || "standard";
    const include = resolvedOptions.effective.include ?? {};
    const traceEnabled = resolvedOptions.effective.traceEnabled;
    const vibe = constraints.vibe as { extract?: boolean; scope?: string; includeNorms?: boolean } | undefined;
    const wantsVibe = vibe?.extract === true;
    const analysis = constraints.analysis as { clusters?: boolean; maxClusters?: number; maxFilesPerCluster?: number } | undefined;
    const wantsAnalysis = analysis?.clusters === true;
    const includeClusters = include?.clusters === true;
    const clusterOptions = constraints.clusterOptions as UnderstandInput["clusterOptions"] | undefined;
    const includeDependencies = include.dependencies === true || include.pageRank === true;
    const includeCalls = include.callGraph === true;
    const explicitPath = helpers.extractPath(subject) ?? (typeof originalIntent === "string" ? helpers.extractPath(originalIntent) : null);
    const symbolHint = helpers.extractSymbol(subject) ?? (typeof originalIntent === "string" ? helpers.extractSymbol(originalIntent) : null);
    const integrityOptions = IntegrityEngine.resolveOptions(constraints.integrity, "understand");
    const policyMaxTokens = resolveEnvelopeMaxTokens("understand");
    const applyPolicyDefaults = resolveMcpMode() === "mcp";
    const timeboxPolicy = resolveTimeboxPolicy();
    const policyTimeoutMs = applyPolicyDefaults && Number.isFinite(timeboxPolicy.perStep) ? timeboxPolicy.perStep : undefined;
    const limits = constraints.limits ?? {};
    if (typeof limits.timeoutMs !== "number" && Number.isFinite(policyTimeoutMs)) {
        limits.timeoutMs = policyTimeoutMs;
    }
    if (resolvedOptions.effective.profile === "lean") {
        if (typeof limits.maxTokens !== "number") {
            const leanTokens = applyPolicyDefaults && Number.isFinite(policyMaxTokens) ? policyMaxTokens : 1600;
            limits.maxTokens = leanTokens;
        }
        if (typeof limits.timeoutMs !== "number") {
            limits.timeoutMs = 4000;
        }
    }
    const maxTokens = typeof limits.maxTokens === "number" && Number.isFinite(limits.maxTokens) && limits.maxTokens > 0
        ? limits.maxTokens
        : (Number.isFinite(policyMaxTokens) ? policyMaxTokens : undefined);

    return {
        constraints,
        subject,
        rawSessionId,
        resolvedSessionId,
        sessionPolicy,
        resolvedOptions,
        depth,
        include,
        traceEnabled,
        vibe,
        wantsVibe,
        analysis,
        wantsAnalysis,
        includeClusters,
        clusterOptions,
        includeDependencies,
        includeCalls,
        explicitPath,
        symbolHint,
        integrityOptions,
        limits,
        maxTokens
    };
}
