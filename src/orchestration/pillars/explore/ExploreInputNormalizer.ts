import type { ParsedIntent } from "../../IntentRouter.js";
import type { FlowArtifactManager } from "../../flow-artifact-manager.js";
import { IntegrityEngine } from "../../../integrity/IntegrityEngine.js";
import { OptionResolver } from "../../options/OptionResolver.js";

export type ExploreInput = {
    constraints: any;
    query?: string;
    paths: string[];
    research?: { sketch?: boolean; topN?: number; format?: "ascii" | "mermaid" | "both" };
    rawSessionId?: string;
    researchRequested: boolean;
    packId?: string;
    fullPaths: string[];
    allowSensitive: boolean;
    allowBinary: boolean;
    allowGlobs: boolean;
    integrityOptions: ReturnType<typeof IntegrityEngine.resolveOptions>;
    resolvedSessionId?: string;
    sessionPolicy?: any;
    resolvedOptions: ReturnType<typeof OptionResolver.resolveExploreOptions>;
    view: ReturnType<typeof OptionResolver.resolveExploreOptions>["effective"]["view"];
    include: any;
    includeExplicit: boolean;
    sourcesWantsDocs: boolean;
    traceEnabled: boolean;
    profile?: string;
    limits: {
        maxResults?: number;
        maxChars?: number;
        maxTokens?: number;
        maxItemChars?: number;
        maxBytes?: number;
        maxFiles?: number;
        timeoutMs?: number;
    };
};

export function normalizeExploreInput(
    intent: ParsedIntent,
    helpers: {
        resolveSessionId: (rawSessionId: string | undefined, fallback: string) => string | undefined;
        getSessionPolicy: (sessionId: string | undefined) => any;
    }
): ExploreInput {
    const constraints = intent.constraints as any;
    const query = typeof constraints.query === "string" ? constraints.query : undefined;
    const paths = Array.isArray(constraints.paths) ? constraints.paths : [];
    const research = constraints.research as {
        sketch?: boolean;
        topN?: number;
        format?: "ascii" | "mermaid" | "both";
    } | undefined;
    const rawSessionId = typeof constraints.sessionId === "string" ? constraints.sessionId : undefined;
    const researchRequested = !!research && research?.sketch !== false;
    const packId = typeof constraints.packId === "string" ? constraints.packId : undefined;
    const fullPaths = Array.isArray(constraints.fullPaths) ? constraints.fullPaths : [];
    const allowSensitive = constraints.allowSensitive === true;
    const allowBinary = constraints.allowBinary === true;
    const allowGlobs = constraints.allowGlobs === true;
    const integrityOptions = IntegrityEngine.resolveOptions(constraints.integrity, "explore");
    const resolvedSessionId = helpers.resolveSessionId(rawSessionId, intent.originalIntent ?? query ?? "explore");
    const sessionPolicy = helpers.getSessionPolicy(resolvedSessionId);
    const resolvedOptions = OptionResolver.resolveExploreOptions(constraints, sessionPolicy);
    const view = resolvedOptions.effective.view;
    const include = resolvedOptions.effective.include;
    const includeExplicit = resolvedOptions.meta.includeExplicit;
    const sourcesWantsDocs = resolvedOptions.meta.sourcesWantsDocs;
    const traceEnabled = resolvedOptions.effective.traceEnabled;
    const profile = resolvedOptions.effective.profile;
    const limits = resolvedOptions.effective.limits as ExploreInput["limits"];

    return {
        constraints,
        query,
        paths,
        research,
        rawSessionId,
        researchRequested,
        packId,
        fullPaths,
        allowSensitive,
        allowBinary,
        allowGlobs,
        integrityOptions,
        resolvedSessionId,
        sessionPolicy,
        resolvedOptions,
        view,
        include,
        includeExplicit,
        sourcesWantsDocs,
        traceEnabled,
        profile,
        limits
    };
}
