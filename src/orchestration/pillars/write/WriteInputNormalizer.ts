import type { ParsedIntent } from "../../IntentRouter.js";
import { OptionResolver } from "../../options/OptionResolver.js";

export type WriteInput = {
    constraints: any;
    targets: string[];
    originalIntent: string;
    targetPath?: string;
    template?: string;
    content: string;
    hasExplicitContent: boolean;
    safeWrite: boolean;
    quickGenerate: boolean;
    smartWrite: boolean;
    styleReference?: string[];
    resolvedSessionId?: string;
    sessionPolicy?: any;
    resolvedOptions: ReturnType<typeof OptionResolver.resolveWriteOptions>;
    dryRun: boolean;
    traceEnabled: boolean;
    draftOptions?: { skeletonOnly?: boolean };
    reviewOptions: any;
    draftId?: string;
    refinement?: string;
};

export function normalizeWriteInput(
    intent: ParsedIntent,
    helpers: {
        resolveSessionId: (rawSessionId: string | undefined, originalIntent: string) => string | undefined;
        getSessionPolicy: (sessionId: string | undefined) => any;
    }
): WriteInput {
    const { constraints, targets, originalIntent } = intent;
    const baseIntent = originalIntent ?? "";
    const targetPath = constraints.targetPath || targets[0];
    const template = constraints.template;
    const content = constraints.content ?? "";
    const hasExplicitContent = constraints.content !== undefined;
    const safeWriteExplicit = typeof (constraints as any).safeWrite === "boolean";
    let safeWrite = Boolean((constraints as any).safeWrite);
    const quickGenerate = Boolean((constraints as any).quickGenerate);
    const smartWrite = Boolean((constraints as any).smartWrite);
    const styleReference = (constraints as any).styleReference as string[] | undefined;
    const rawSessionId = typeof (constraints as any).sessionId === "string" ? (constraints as any).sessionId : undefined;
    const resolvedSessionId = helpers.resolveSessionId(rawSessionId, baseIntent);
    const sessionPolicy = helpers.getSessionPolicy(resolvedSessionId);
    const resolvedOptions = OptionResolver.resolveWriteOptions(constraints, resolvedSessionId, sessionPolicy);
    if (!safeWriteExplicit && resolvedOptions.effective.profile === "lean") {
        safeWrite = true;
    }
    const dryRun = resolvedOptions.effective.dryRun;
    const traceEnabled = resolvedOptions.effective.traceEnabled;
    const draftOptions = (constraints as any).draftOptions as { skeletonOnly?: boolean } | undefined;
    const reviewOptions = resolvedOptions.effective.reviewOptions;
    const draftId = typeof (constraints as any).draftId === "string" ? (constraints as any).draftId : undefined;
    const refinement = typeof (constraints as any).refinement === "string" ? (constraints as any).refinement : undefined;

    return {
        constraints,
        targets,
        originalIntent: baseIntent,
        targetPath,
        template,
        content,
        hasExplicitContent,
        safeWrite,
        quickGenerate,
        smartWrite,
        styleReference,
        resolvedSessionId,
        sessionPolicy,
        resolvedOptions,
        dryRun,
        traceEnabled,
        draftOptions,
        reviewOptions,
        draftId,
        refinement
    };
}
