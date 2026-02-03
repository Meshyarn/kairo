import type { ImportInfo, ExportInfo } from "../../indexing/ProjectIndex.js";
import type { AstManager } from "../../ast/AstManager.js";
import type { UnifiedExtractor } from "../../ast/extraction/UnifiedExtractor.js";
import type { ModuleResolver } from "../../ast/ModuleResolver.js";
import type {
    ExportExtractionResult,
    ImportExtractionResult,
    LanguageParityMode,
    ParityResult
} from "./IntegrityGuardrailsTypes.js";

export const resolveParityAvailability = async (
    astManager: AstManager,
    filePath: string,
    languageId: string,
    queryName: string
): Promise<{ available: boolean }> => {
    try {
        const language = await astManager.getLanguageForFile(filePath);
        if (!language) {
            return { available: false };
        }
        const query = await astManager.getQueryProvider().getQuery(language, languageId, queryName);
        return { available: Boolean(query) };
    } catch {
        return { available: false };
    }
};

export const extractImportsWithParity = async (args: {
    filePath: string;
    content: string;
    languageId: string;
    mode: LanguageParityMode;
    extractor: UnifiedExtractor;
    astManager: AstManager;
    moduleResolver: ModuleResolver;
}): Promise<ImportExtractionResult> => {
    const parity = await resolveParityAvailability(args.astManager, args.filePath, args.languageId, "imports");
    if (!parity.available && args.mode === "strict") {
        return { imports: [], parity: { degraded: false, blocked: true } };
    }
    if (parity.available) {
        return {
            imports: await args.extractor.extractImports(args.filePath, args.content, args.languageId, {
                docProvider: () => args.astManager.parseFile(args.filePath, args.content)
            }),
            parity: { degraded: false, blocked: false }
        };
    }
    const fallback = await fallbackExtractImports(args);
    return {
        imports: fallback,
        parity: {
            degraded: true,
            blocked: false,
            confidence: args.mode === "balanced" ? "low" : "medium"
        }
    };
};

export const extractExportsWithParity = async (args: {
    filePath: string;
    content: string;
    languageId: string;
    mode: LanguageParityMode;
    extractor: UnifiedExtractor;
    astManager: AstManager;
    moduleResolver: ModuleResolver;
}): Promise<ExportExtractionResult> => {
    const parity = await resolveParityAvailability(args.astManager, args.filePath, args.languageId, "exports");
    if (!parity.available && args.mode === "strict") {
        return { exports: [], parity: { degraded: false, blocked: true } };
    }
    if (parity.available) {
        return {
            exports: await args.extractor.extractExports(args.filePath, args.content, args.languageId, {
                docProvider: () => args.astManager.parseFile(args.filePath, args.content)
            }),
            parity: { degraded: false, blocked: false }
        };
    }
    const fallback = await fallbackExtractExports(args);
    return {
        exports: fallback,
        parity: {
            degraded: true,
            blocked: false,
            confidence: args.mode === "balanced" ? "low" : "medium"
        }
    };
};

const fallbackExtractImports = async (args: {
    filePath: string;
    content: string;
    languageId: string;
    extractor: UnifiedExtractor;
    moduleResolver: ModuleResolver;
}): Promise<ImportInfo[]> => {
    if (args.extractor.supportsRegex(args.languageId)) {
        return args.extractor.extractImports(args.filePath, args.content, args.languageId, {
            preferBackend: "regex"
        });
    }
    const matches = extractFallbackImportSpecifiers(args.content);
    return matches.map(item => ({
        specifier: item.specifier,
        resolvedPath: args.moduleResolver.resolve(args.filePath, item.specifier) ?? undefined,
        what: [],
        line: item.line,
        importType: "named"
    }));
};

const fallbackExtractExports = async (args: {
    filePath: string;
    content: string;
    languageId: string;
    extractor: UnifiedExtractor;
}): Promise<ExportInfo[]> => {
    if (args.extractor.supportsRegex(args.languageId)) {
        return args.extractor.extractExports(args.filePath, args.content, args.languageId, {
            preferBackend: "regex"
        });
    }
    const matches = extractFallbackExportNames(args.content);
    return matches.map(item => ({
        name: item.name,
        exportType: item.exportType,
        line: item.line,
        isReExport: false
    }));
};

const extractFallbackImportSpecifiers = (content: string): Array<{ specifier: string; line: number }> => {
    const patterns = [
        /\bimport\s+[^'"]*['"]([^'"]+)['"]/g,
        /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        /^\s*#include\s+[<"]([^">]+)[">]/gm,
        /\bfrom\s+['"]([^'"]+)['"]\s+import\s+/g
    ];
    const results: Array<{ specifier: string; line: number }> = [];
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of patterns) {
            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(line)) !== null) {
                if (!match[1]) continue;
                results.push({ specifier: match[1], line: i + 1 });
            }
        }
    }
    return results;
};

const extractFallbackExportNames = (
    content: string
): Array<{ name: string; exportType: "named" | "default"; line: number }> => {
    const patterns = [
        /\bexport\s+(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z0-9_]+)/g,
        /\bexport\s+default\b/g,
        /\bpublic\s+(?:class|interface|enum)\s+([A-Za-z0-9_]+)/g,
        /\bpub\s+fn\s+([A-Za-z0-9_]+)/g,
        /\bdef\s+([A-Za-z0-9_]+)\s*\(/g
    ];
    const results: Array<{ name: string; exportType: "named" | "default"; line: number }> = [];
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of patterns) {
            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(line)) !== null) {
                if (pattern.source.includes("export\\s+default")) {
                    results.push({ name: "default", exportType: "default", line: i + 1 });
                    continue;
                }
                const name = match[1];
                if (!name) continue;
                results.push({ name, exportType: "named", line: i + 1 });
            }
        }
    }
    return results;
};

export const mergeParity = (left?: ParityResult, right?: ParityResult): ParityResult | undefined => {
    if (!left && !right) return undefined;
    return {
        degraded: Boolean(left?.degraded || right?.degraded),
        blocked: Boolean(left?.blocked || right?.blocked),
        confidence: left?.confidence ?? right?.confidence
    };
};
