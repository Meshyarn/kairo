import path from "path";
import type { CodeHandlerDeps } from "./CodeHandlerUtils.js";

export const executeReconstructInterface = async (deps: CodeHandlerDeps, args: any) => {
    const symbolName = args?.symbolName;
    if (!symbolName) {
        return { success: false, message: "symbolName is required." };
    }
    const ghostInterface = await deps.context.fallbackResolver.reconstructGhostInterface(symbolName);
    if (!ghostInterface) {
        return { success: false, message: "Ghost interface reconstruction failed." };
    }
    return { success: true, ghostInterface };
};

export const executeAnalyzeFile = async (deps: CodeHandlerDeps, args: any) => {
    const filePath = deps.resolveRelativePath(args.filePath);
    const content = await deps.context.fileSystem.readFile(filePath);
    const stats = await deps.context.fileSystem.stat(filePath);
    return {
        filePath,
        sizeBytes: stats.size,
        lineCount: content.length === 0 ? 0 : content.split(/\r?\n/).length,
        language: path.extname(filePath).replace(".", "") || null
    };
};

export const listFilesRaw = async (deps: CodeHandlerDeps, args: any) => {
    const basePath = typeof args?.basePath === "string" ? args.basePath : ".";
    const depth = Number.isFinite(args?.depth) ? Math.max(0, args.depth) : 5;
    const maxFiles = Number.isFinite(args?.maxFiles) ? Math.max(1, args.maxFiles) : 200;
    const results: Array<{ path: string; mtime?: number; size?: number }> = [];

    let resolvedBase: string;
    try {
        resolvedBase = deps.resolveRelativePath(basePath);
    } catch {
        return results;
    }

    try {
        const baseStats = await deps.context.fileSystem.stat(resolvedBase);
        if (!baseStats.isDirectory()) {
            const relativeBase = resolvedBase.replace(/\\/g, "/");
            results.push({ path: relativeBase, mtime: baseStats.mtime, size: baseStats.size });
            return results;
        }
    } catch {
        return results;
    }

    const walk = async (current: string, currentDepth: number) => {
        if (results.length >= maxFiles) return;
        let entries: string[] = [];
        try {
            entries = await deps.context.fileSystem.readDir(current);
        } catch {
            return;
        }

        for (const entry of entries) {
            if (results.length >= maxFiles) break;
            const fullPath = path.join(current, entry);
            const relative = deps.resolveRelativePath(fullPath);
            const relativeNormalized = relative.replace(/\\/g, "/");

            let stats: any;
            try {
                stats = await deps.context.fileSystem.stat(fullPath);
            } catch {
                continue;
            }

            if (stats.isDirectory()) {
                if (currentDepth < depth) {
                    await walk(fullPath, currentDepth + 1);
                }
            } else {
                results.push({ path: relativeNormalized, mtime: stats.mtime, size: stats.size });
            }
        }
    };

    await walk(resolvedBase, 0);
    return results;
};

export const statFileRaw = async (deps: CodeHandlerDeps, args: any) => {
    const inputPath = args?.path ?? args?.filePath;
    if (!inputPath) {
        throw new Error("Missing path for file_stat.");
    }
    const relative = deps.resolveRelativePath(inputPath);
    const stats = await deps.context.fileSystem.stat(relative);
    return {
        path: relative.replace(/\\/g, "/"),
        size: stats.size,
        mtime: stats.mtime,
        isDirectory: stats.isDirectory()
    };
};

export const findReferencesRaw = async (deps: CodeHandlerDeps, args: any) => {
    const symbolName = args?.symbolName ?? args?.symbol ?? args?.target;
    if (!symbolName) {
        return { success: false, message: "symbolName is required." };
    }

    const definitionPath = args?.definitionPath ?? args?.filePath ?? args?.contextPath;
    let resolvedDefinition: string | undefined;
    if (definitionPath) {
        resolvedDefinition = deps.resolveAbsolutePath(definitionPath);
    } else {
        const matches = await deps.context.symbolIndex.search(symbolName);
        if (matches.length > 0) {
            resolvedDefinition = path.isAbsolute(matches[0].filePath)
                ? matches[0].filePath
                : deps.resolveAbsolutePath(matches[0].filePath);
        }
    }

    if (!resolvedDefinition) {
        return { success: false, message: `Symbol '${symbolName}' not found.` };
    }

    await deps.context.dependencyGraph.ensureBuilt();
    const references = await deps.context.referenceFinder.findReferences(symbolName, resolvedDefinition);
    return {
        success: true,
        symbolName,
        definitionFile: deps.resolveRelativePath(resolvedDefinition),
        references
    };
};

export const projectStatsRaw = async (deps: CodeHandlerDeps) => {
    let status: { global?: { totalFiles?: number; indexedFiles?: number; unresolvedImports?: number; confidence?: string } } | undefined;
    try {
        status = await deps.context.dependencyGraph.getIndexStatus();
    } catch {
        status = undefined;
    }

    let fileCount = status?.global?.totalFiles ?? 0;
    if (fileCount === 0) {
        try {
            const files = await deps.context.fileSystem.listFiles(deps.context.rootPath);
            fileCount = files.length;
        } catch {
            fileCount = 0;
        }
    }

    return {
        fileCount,
        indexedFiles: status?.global?.indexedFiles ?? fileCount,
        unresolvedImports: status?.global?.unresolvedImports ?? 0,
        confidence: status?.global?.confidence ?? (fileCount > 0 ? "medium" : "low")
    };
};
