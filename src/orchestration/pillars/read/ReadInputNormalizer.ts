import type { ParsedIntent } from "../../IntentRouter.js";

type ReadConstraints = Record<string, any>;

export type ReadInput = {
    targets: string[];
    constraints: ReadConstraints;
    originalIntent?: string;
    target: string;
    view: string;
    includeProfile: boolean;
    includeHash: boolean;
    resolvedPath: string;
    lineRange?: string;
    sectionId?: string;
    headingPath?: string[];
    isDocument: boolean;
    maxTokens?: number;
};

export async function normalizeReadInput(
    intent: ParsedIntent,
    helpers: {
        resolveTargetPath: (target: string) => Promise<string>;
        normalizeLineRange: (value: any) => string | undefined;
        isDocumentPath: (value: string) => boolean;
    }
): Promise<ReadInput> {
    const { targets, constraints, originalIntent } = intent;
    const target = constraints.targetPath || targets[0] || originalIntent;
    const view = constraints.view ?? (constraints.depth === "deep" ? "full" : "skeleton");
    const includeProfile = constraints.includeProfile === true;
    const includeHash = constraints.includeHash === true;
    const resolvedPath = await helpers.resolveTargetPath(target);
    const lineRange = helpers.normalizeLineRange(constraints.lineRange);
    const sectionId = constraints.sectionId;
    const headingPath = constraints.headingPath;
    const isDocument = helpers.isDocumentPath(resolvedPath);
    const envMaxTokens = Number.parseInt(
        process.env.KAIRO_READ_MAX_TOKENS ?? process.env.KAIRO_DEFAULT_MAX_TOKENS ?? "",
        10
    );
    const limits = constraints.limits ?? {};
    const maxTokens = typeof limits.maxTokens === "number" && Number.isFinite(limits.maxTokens) && limits.maxTokens > 0
        ? limits.maxTokens
        : (Number.isFinite(envMaxTokens) && envMaxTokens > 0 ? envMaxTokens : undefined);

    return {
        targets,
        constraints,
        originalIntent,
        target,
        view,
        includeProfile,
        includeHash,
        resolvedPath,
        lineRange,
        sectionId,
        headingPath,
        isDocument,
        maxTokens
    };
}
