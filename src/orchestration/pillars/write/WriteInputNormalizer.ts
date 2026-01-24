import type { ParsedIntent } from "../../IntentRouter.js";
import { OptionResolver } from "../../options/OptionResolver.js";
import type { ContentSource } from "../../../types/content-source.js";

export type WriteInput = {
    constraints: any;
    targets: string[];
    originalIntent: string;
    targetPath?: string;
    template?: string;
    content: string;
    contentSource?: ContentSource;
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
    applyToken?: string;
    refinement?: string;
};

export function normalizeWriteInput(
    intent: ParsedIntent,
    helpers: {
        resolveSessionId: (rawSessionId: string | undefined, originalIntent: string) => string | undefined;
        getSessionPolicy: (sessionId: string | undefined) => any;
        resolveDraftSessionId?: (draftId: string) => string | undefined;
    }
): WriteInput {
    const decodeBase64 = (value: unknown): string | undefined => {
        if (typeof value !== "string" || value.length === 0) return undefined;
        return Buffer.from(value, "base64").toString("utf8");
    };
    const { constraints, targets, originalIntent } = intent;
    const baseIntent = originalIntent ?? "";
    const targetPath = constraints.targetPath || targets[0];
    const template = constraints.template;
    const contentSource = (constraints as any).contentSource as ContentSource | undefined;
    const decodedContent = decodeBase64((constraints as any).contentBase64 ?? (constraints as any).contentB64);
    const content = decodedContent ?? constraints.content ?? "";
    const hasExplicitContent = contentSource !== undefined || constraints.content !== undefined || typeof decodedContent === "string";
    const safeWriteExplicit = typeof (constraints as any).safeWrite === "boolean";
    let safeWrite = Boolean((constraints as any).safeWrite);
    const quickGenerate = Boolean((constraints as any).quickGenerate);
    const smartWrite = Boolean((constraints as any).smartWrite);
    const styleReference = (constraints as any).styleReference as string[] | undefined;
    const draftId = typeof (constraints as any).draftId === "string" ? (constraints as any).draftId : undefined;
    const applyToken = typeof (constraints as any).applyToken === "string" ? (constraints as any).applyToken : undefined;
    const rawSessionId = typeof (constraints as any).sessionId === "string" ? (constraints as any).sessionId : undefined;
    const draftSessionId = draftId ? helpers.resolveDraftSessionId?.(draftId) : undefined;
    const resolvedSessionId = helpers.resolveSessionId(draftSessionId ?? rawSessionId, baseIntent);
    const sessionPolicy = helpers.getSessionPolicy(resolvedSessionId);
    const resolvedOptions = OptionResolver.resolveWriteOptions(constraints, resolvedSessionId, sessionPolicy);
    if (!safeWriteExplicit && resolvedOptions.effective.profile === "lean") {
        safeWrite = true;
    }
    const dryRun = resolvedOptions.effective.dryRun;
    const traceEnabled = resolvedOptions.effective.traceEnabled;
    const draftOptions = (constraints as any).draftOptions as { skeletonOnly?: boolean } | undefined;
    const reviewOptions = resolvedOptions.effective.reviewOptions;
    const refinement = typeof (constraints as any).refinement === "string" ? (constraints as any).refinement : undefined;

    return {
        constraints,
        targets,
        originalIntent: baseIntent,
        targetPath,
        template,
        content,
        contentSource,
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
        applyToken,
        refinement
    };
}
