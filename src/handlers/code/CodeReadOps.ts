import path from "path";
import { FileProfiler } from "../../engine/FileProfiler.js";
import type { CodeHandlerDeps } from "./CodeHandlerUtils.js";
import { buildSkeletonFallback, inferDocumentKind, parseLineRanges } from "./CodeHandlerUtils.js";

export const readCodeRaw = async (deps: CodeHandlerDeps, args: any): Promise<string> => {
    const { context, resolveRelativePath, resolveAbsolutePath } = deps;
    const view = (args?.view ?? "skeleton") as string;
    const filePath = resolveRelativePath(args.filePath);
    const absPath = resolveAbsolutePath(args.filePath);

    if (view === "fragment") {
        const ranges = parseLineRanges(args.lineRange);
        const fragment = await context.contextEngine.readFragment(absPath, ranges);
        return fragment.content;
    }

    if (view === "full") {
        return context.fileSystem.readFile(filePath);
    }

    const skeletonOptions = args?.skeletonOptions ?? {};
    try {
        const astManager = context.astManager;
        const content = await context.fileSystem.readFile(filePath);
        return await context.skeletonCache.getSkeleton(
            absPath,
            skeletonOptions,
            async (targetPath, options) => {
                try {
                    return await astManager.generateUniversalSkeleton(targetPath, content, options);
                } catch {
                    return context.skeletonGenerator.generateSkeleton(targetPath, content, options);
                }
            }
        );
    } catch (error: any) {
        const content = await context.fileSystem.readFile(filePath);
        return buildSkeletonFallback(content, error?.message);
    }
};

export const readFileRaw = async (deps: CodeHandlerDeps, args: any) => {
    const { context, resolveRelativePath, resolveAbsolutePath } = deps;
    const filePath = resolveRelativePath(args.filePath);
    const absPath = resolveAbsolutePath(args.filePath);
    try {
        if (args?.full) {
            const content = await context.fileSystem.readFile(filePath);
            const maxBytes = parseInt(process.env.KAIRO_READ_FILE_MAX_BYTES || "", 10);
            const effectiveMax = Number.isFinite(maxBytes) ? maxBytes : content.length;
            const buffer = Buffer.from(content, "utf-8");
            const truncated = buffer.length > effectiveMax;
            const slice = truncated ? buffer.slice(0, effectiveMax).toString("utf-8") : content;
            const stats = await context.fileSystem.stat(filePath);
            const versionInfo = await context.fileVersionManager.getVersion(absPath);
            return {
                content: slice,
                meta: {
                    truncated,
                    bytesReturned: Buffer.byteLength(slice, "utf-8"),
                    maxBytes: effectiveMax,
                    fileSizeBytes: stats.size,
                    nextAction: { tool: "code_read", args: { filePath, view: "skeleton" } }
                },
                versionInfo
            };
        }
        return await readFileProfileRaw(deps, { filePath });
    } catch (error: any) {
        const wrapped = new Error(error?.message ?? "Failed to read file.");
        (wrapped as any).code = "InternalError";
        throw wrapped;
    }
};

export const readFragmentRaw = async (deps: CodeHandlerDeps, args: any) => {
    const { context, resolveRelativePath, resolveAbsolutePath } = deps;
    const filePath = resolveRelativePath(args.filePath);
    const absPath = resolveAbsolutePath(args.filePath);
    try {
        const content = await context.fileSystem.readFile(filePath);
        const lines = content.split(/\r?\n/);
        const contextLines = typeof args?.contextLines === "number" ? args.contextLines : 0;
        const ranges: Array<{ start: number; end: number }> = [];

        if (Array.isArray(args?.lineRanges) && args.lineRanges.length > 0) {
            for (const range of args.lineRanges) {
                if (range?.start && range?.end) {
                    ranges.push({ start: range.start, end: range.end });
                }
            }
        } else if (Array.isArray(args?.keywords) && args.keywords.length > 0) {
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (args.keywords.some((kw: string) => line.includes(kw))) {
                    const lineNumber = i + 1;
                    ranges.push({ start: lineNumber, end: lineNumber });
                }
            }
        }

        const fragment = await context.contextEngine.readFragment(absPath, ranges, contextLines);
        const versionInfo = await context.fileVersionManager.getVersion(absPath);
        return {
            ...fragment,
            versionInfo
        };
    } catch {
        throw new Error(`File not found: ${filePath}`);
    }
};

export const readFileProfileRaw = async (deps: CodeHandlerDeps, args: any) => {
    const { context, resolveRelativePath, resolveAbsolutePath } = deps;
    const filePath = resolveRelativePath(args.filePath);
    const absPath = resolveAbsolutePath(args.filePath);
    const content = await context.fileSystem.readFile(filePath);
    const stats = await context.fileSystem.stat(filePath);
    const versionInfo = await context.fileVersionManager.getVersion(absPath);
    const metadata = FileProfiler.analyzeMetadata(content, absPath);
    const docKind = inferDocumentKind(filePath);
    const isDocument = docKind !== "unknown";
    let outgoing: any[] = [];
    let incoming: any[] = [];
    let skeleton = "";
    let symbols: any[] = [];
    let document: any = undefined;

    if (isDocument) {
        try {
            const profile = await context.documentProfiler.profile({
                filePath,
                content,
                kind: docKind,
                options: args?.outlineOptions
            });
            skeleton = context.documentProfiler.buildSkeleton(profile);
            document = profile;
        } catch (error: any) {
            skeleton = buildSkeletonFallback(content, error?.message);
            document = undefined;
        }
    } else {
        await context.dependencyGraph.ensureBuilt();
        outgoing = await context.dependencyGraph.getDependencies(filePath, "downstream");
        incoming = await context.dependencyGraph.getDependencies(filePath, "upstream");
        try {
            skeleton = await context.skeletonGenerator.generateSkeleton(absPath, content);
            symbols = await context.symbolIndex.getSymbolsForFile(absPath);
        } catch (error: any) {
            skeleton = buildSkeletonFallback(content, error?.message);
            symbols = [];
        }
    }

    return {
        metadata: {
            filePath: absPath,
            relativePath: filePath,
            sizeBytes: stats.size,
            lineCount: content.length === 0 ? 0 : content.split(/\r?\n/).length,
            language: path.extname(filePath).replace(".", "") || null,
            lastModified: new Date(stats.mtime).toISOString(),
            newlineStyle: metadata.newlineStyle,
            encoding: "utf-8",
            hasBOM: metadata.hasBOM,
            usesTabs: metadata.usesTabs,
            indentSize: metadata.indentSize,
            isConfigFile: metadata.isConfigFile,
            configType: metadata.configType,
            configScope: metadata.configScope
        },
        versionInfo,
        structure: {
            skeleton,
            symbols,
            document: document ? {
                kind: document.kind,
                title: document.title,
                outline: document.outline,
                links: document.links
            } : undefined
        },
        usage: {
            incomingCount: incoming.length,
            incomingFiles: Array.from(new Set(incoming.map(edge => edge.from))),
            outgoingCount: outgoing.length,
            outgoingFiles: Array.from(new Set(outgoing.map(edge => edge.to)))
        },
        guidance: {
            bodyHidden: true,
            readFullHint: `Use code_read with view="full" to see full content of ${filePath}.`,
            readFragmentHint: `Use code_read with view="fragment" and lineRange to zoom into specific sections.`
        }
    };
};
