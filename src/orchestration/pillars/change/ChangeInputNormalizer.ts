import type { ParsedIntent } from "../../IntentRouter.js";
import { IntegrityEngine } from "../../../integrity/IntegrityEngine.js";
import { OptionResolver } from "../../options/OptionResolver.js";

export type ChangeInput = {
    targets: string[];
    constraints: any;
    originalIntent: string;
    includeImpact: boolean;
    includeSymbolImpact: boolean;
    integrityOptions: ReturnType<typeof IntegrityEngine.resolveOptions>;
    resolvedSessionId?: string;
    sessionPolicy?: any;
    resolvedOptions: ReturnType<typeof OptionResolver.resolveChangeOptions>;
    dryRun: boolean;
    reviewOptions: any;
    traceEnabled: boolean;
    diffMode: any;
    draftId?: string;
    applyToken?: string;
    refinement?: string;
    refinedIntent: string;
};

export function normalizeChangeInput(
    intent: ParsedIntent,
    helpers: {
        resolveSessionId: (rawSessionId: string | undefined, originalIntent: string) => string | undefined;
        getSessionPolicy: (sessionId: string | undefined) => any;
    }
): ChangeInput {
    const { targets, constraints, originalIntent } = intent;
    const baseIntent = originalIntent ?? "";
    const { includeImpact = false, includeSymbolImpact = false } = constraints;
    const integrityOptions = IntegrityEngine.resolveOptions(constraints.integrity, "change");
    const rawSessionId = typeof constraints.sessionId === "string" ? constraints.sessionId : undefined;
    const resolvedSessionId = helpers.resolveSessionId(rawSessionId, baseIntent);
    const sessionPolicy = helpers.getSessionPolicy(resolvedSessionId);
    const resolvedOptions = OptionResolver.resolveChangeOptions(constraints, resolvedSessionId, sessionPolicy);
    const dryRun = resolvedOptions.effective.dryRun;
    const reviewOptions = resolvedOptions.effective.reviewOptions;
    const traceEnabled = resolvedOptions.effective.traceEnabled;
    const diffMode = resolvedOptions.effective.diffMode;
    const draftId = typeof (constraints as any).draftId === "string" ? (constraints as any).draftId : undefined;
    const applyToken = typeof (constraints as any).applyToken === "string" ? (constraints as any).applyToken : undefined;
    const refinement = typeof (constraints as any).refinement === "string" ? (constraints as any).refinement : undefined;
    const refinedIntent = refinement ? `${baseIntent}\nRefinement: ${refinement}` : baseIntent;

    return {
        targets,
        constraints,
        originalIntent: baseIntent,
        includeImpact,
        includeSymbolImpact,
        integrityOptions,
        resolvedSessionId,
        sessionPolicy,
        resolvedOptions,
        dryRun,
        reviewOptions,
        traceEnabled,
        diffMode,
        draftId,
        applyToken,
        refinement,
        refinedIntent
    };
}
