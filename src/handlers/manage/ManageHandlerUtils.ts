import path from "path";
import { PathManager } from "../../utils/PathManager.js";
import type { HandlerContext } from "../HandlerContext.js";

export type ManageReindexState = {
    inProgress: boolean;
    lastResult?: { success: boolean; output: string; startedAt: string; finishedAt?: string };
};

export interface ManageHandlerDeps {
    context: HandlerContext;
    reindexState: ManageReindexState;
    schemaArtifactTtlMs: number;
    resolveRelativePath: (inputPath: string) => string;
    resolveAbsolutePath: (inputPath: string) => string;
    isWithinKairoDir: (targetPath: string) => boolean;
}

export const createManageHandlerDeps = (
    context: HandlerContext,
    reindexState: ManageReindexState,
    schemaArtifactTtlMs: number
): ManageHandlerDeps => ({
    context,
    reindexState,
    schemaArtifactTtlMs,
    resolveRelativePath: (inputPath: string) => context.pathNormalizer.normalize(inputPath),
    resolveAbsolutePath: (inputPath: string) => context.pathNormalizer.toAbsolute(context.pathNormalizer.normalize(inputPath)),
    isWithinKairoDir: (targetPath: string) => {
        const baseDir = path.resolve(PathManager.resolve());
        const resolvedTarget = path.resolve(targetPath);
        const relative = path.relative(baseDir, resolvedTarget);
        if (!relative || relative === ".") return true;
        return !relative.startsWith("..") && !path.isAbsolute(relative);
    }
});
