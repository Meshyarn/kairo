import path from "path";
import type { DefinitionSymbol, SymbolInfo } from "../../types.js";
import type { UnifiedExtractor } from "../../ast/extraction/UnifiedExtractor.js";
import type { AstManager } from "../../ast/AstManager.js";
import type { ExportInfo } from "../../indexing/ProjectIndex.js";
import { AstDiffEngine, type AstChange } from "../../ast/AstDiffEngine.js";
import type { LanguageParityMode, ParityResult, PublicSurfaceResult } from "./IntegrityGuardrailsTypes.js";
import { resolveParityAvailability } from "./IntegrityGuardrailsParity.js";

export const evaluatePublicSurfaceChanges = async (args: {
    filePath: string;
    oldExports: ExportInfo[];
    newExports: ExportInfo[];
    oldContent: string;
    newContent: string;
    languageId: string;
    mode: LanguageParityMode;
    extractor: UnifiedExtractor;
    astManager: AstManager;
    impactThreshold: number;
    runTool?: (tool: string, args: any) => Promise<any>;
}): Promise<PublicSurfaceResult> => {
    const oldSet = new Set(args.oldExports.map((exp) => `${exp.exportType}:${exp.name}`));
    const newSet = new Set(args.newExports.map((exp) => `${exp.exportType}:${exp.name}`));
    const changes: Array<{ type: "added" | "removed" | "modified"; name: string; exportType: string }> = [];
    for (const oldId of oldSet) {
        if (!newSet.has(oldId)) {
            const [exportType, name] = oldId.split(":");
            changes.push({ type: "removed", name, exportType });
        }
    }
    for (const newId of newSet) {
        if (!oldSet.has(newId)) {
            const [exportType, name] = newId.split(":");
            changes.push({ type: "added", name, exportType });
        }
    }

    const breakingResult = await detectBreakingPublicSurface({
        filePath: args.filePath,
        oldContent: args.oldContent,
        newContent: args.newContent,
        languageId: args.languageId,
        mode: args.mode,
        extractor: args.extractor,
        astManager: args.astManager,
        oldExports: args.oldExports,
        newExports: args.newExports
    });
    const breakingChanges = breakingResult.changes;
    if (breakingChanges.length > 0) {
        const knownExports = new Map(args.oldExports.map(exp => [exp.name, exp.exportType]));
        for (const change of breakingChanges) {
            const exists = changes.some(entry => entry.name === change.symbolName);
            if (!exists) {
                changes.push({
                    type: "modified",
                    name: change.symbolName,
                    exportType: knownExports.get(change.symbolName) ?? "named"
                });
            }
        }
    }

    if (changes.length === 0) {
        return {
            hasChanges: false,
            changes: [],
            impacts: [],
            totalImpact: 0,
            requiresBatchRefactoring: false,
            riskLevel: "low",
            parity: breakingResult.parity
        };
    }

    const impacts: Array<{ name: string; impactCount: number; impactedFiles: string[] }> = [];
    for (const change of changes.filter(item => item.type === "removed")) {
        const refs = args.runTool
            ? await args.runTool("reference_find", {
                symbolName: change.name,
                definitionPath: args.filePath
            }).catch(() => null)
            : null;
        const files = Array.isArray(refs?.references)
            ? refs.references.map((ref: any) => ref.filePath).filter(Boolean)
            : [];
        impacts.push({
            name: change.name,
            impactCount: files.length,
            impactedFiles: files
        });
    }

    const totalImpact = impacts.reduce((sum, item) => sum + item.impactCount, 0);
    const requiresBatchRefactoring = totalImpact >= args.impactThreshold || breakingChanges.length > 0;
    const hasRemoval = changes.some(change => change.type === "removed");
    const hasBreaking = breakingChanges.length > 0;
    const riskLevel = hasBreaking || (hasRemoval && totalImpact >= args.impactThreshold)
        ? "high"
        : hasRemoval
            ? "medium"
            : "low";

    return {
        hasChanges: true,
        changes,
        impacts,
        totalImpact,
        requiresBatchRefactoring,
        riskLevel,
        breakingChanges: breakingChanges.length > 0 ? breakingChanges : undefined,
        parity: breakingResult.parity
    };
};

const detectBreakingPublicSurface = async (args: {
    filePath: string;
    oldContent: string;
    newContent: string;
    languageId: string;
    mode: LanguageParityMode;
    extractor: UnifiedExtractor;
    astManager: AstManager;
    oldExports: ExportInfo[];
    newExports: ExportInfo[];
}): Promise<{ changes: AstChange[]; parity: ParityResult }> => {
    const exportNames = collectExportedNames(args.oldExports, args.newExports);
    if (exportNames.size === 0) {
        return { changes: [], parity: { degraded: false, blocked: false } };
    }

    const parity = await resolveParityAvailability(args.astManager, args.filePath, args.languageId, "symbols");
    if (!parity.available) {
        if (args.mode === "strict") {
            return { changes: [], parity: { degraded: false, blocked: true } };
        }
        const fallbackChanges = await detectBreakingPublicSurfaceWithRegex(args.filePath, args.oldContent, args.newContent);
        return {
            changes: fallbackChanges,
            parity: {
                degraded: true,
                blocked: false,
                confidence: args.mode === "balanced" ? "low" : "medium"
            }
        };
    }

    const [oldSymbols, newSymbols] = await Promise.all([
        args.extractor.extractSymbols(args.filePath, args.oldContent, args.languageId, {
            docProvider: () => args.astManager.parseFile(args.filePath, args.oldContent)
        }),
        args.extractor.extractSymbols(args.filePath, args.newContent, args.languageId, {
            docProvider: () => args.astManager.parseFile(args.filePath, args.newContent)
        })
    ]);

    const breakingChanges = compareExportedSignatures({
        exportNames,
        oldSymbols: filterDefinitionSymbols(oldSymbols),
        newSymbols: filterDefinitionSymbols(newSymbols)
    });

    return {
        changes: breakingChanges,
        parity: { degraded: false, blocked: false }
    };
};

const detectBreakingPublicSurfaceWithRegex = async (
    filePath: string,
    oldContent: string,
    newContent: string
): Promise<AstChange[]> => {
    const ext = path.extname(filePath).toLowerCase();
    if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
        return [];
    }
    const diffEngine = new AstDiffEngine();
    const result = await diffEngine.diff(filePath, oldContent, newContent);
    return result.changes.filter(change => change.isBreaking);
};

const collectExportedNames = (oldExports: ExportInfo[], newExports: ExportInfo[]): Set<string> => {
    const names = new Set<string>();
    for (const exp of [...oldExports, ...newExports]) {
        if (exp.exportType !== "named" || exp.isReExport) continue;
        names.add(exp.name);
    }
    return names;
};

const filterDefinitionSymbols = (symbols: SymbolInfo[]): DefinitionSymbol[] => {
    const allowedTypes = new Set([
        "class",
        "function",
        "method",
        "interface",
        "variable",
        "export_specifier",
        "type_alias"
    ]);
    return symbols.filter((symbol): symbol is DefinitionSymbol => allowedTypes.has(symbol.type));
};

const compareExportedSignatures = (args: {
    exportNames: Set<string>;
    oldSymbols: DefinitionSymbol[];
    newSymbols: DefinitionSymbol[];
}): AstChange[] => {
    const changes: AstChange[] = [];
    const oldMap = groupSymbolsByName(args.oldSymbols);
    const newMap = groupSymbolsByName(args.newSymbols);

    for (const name of args.exportNames) {
        const oldEntries = oldMap.get(name) ?? [];
        const newEntries = newMap.get(name) ?? [];
        if (oldEntries.length === 0 || newEntries.length === 0) {
            continue;
        }

        const oldTypes = new Set(oldEntries.map(entry => entry.type));
        const newTypes = new Set(newEntries.map(entry => entry.type));
        if (!setEquals(oldTypes, newTypes)) {
            changes.push({
                type: "type-change",
                symbolName: name,
                symbolType: oldEntries[0]?.type ?? newEntries[0]?.type ?? "function",
                isBreaking: true
            });
        }

        const oldSignatures = normalizeSignatureSet(oldEntries);
        const newSignatures = normalizeSignatureSet(newEntries);
        if (!arrayEquals(oldSignatures, newSignatures)) {
            changes.push({
                type: "signature-change",
                symbolName: name,
                symbolType: oldEntries[0]?.type ?? newEntries[0]?.type ?? "function",
                isBreaking: true,
                oldSignature: oldSignatures.join(" | "),
                newSignature: newSignatures.join(" | ")
            });
        }
    }

    return changes;
};

const groupSymbolsByName = (symbols: DefinitionSymbol[]): Map<string, DefinitionSymbol[]> => {
    const map = new Map<string, DefinitionSymbol[]>();
    for (const symbol of symbols) {
        const current = map.get(symbol.name) ?? [];
        current.push(symbol);
        map.set(symbol.name, current);
    }
    return map;
};

const normalizeSignatureSet = (symbols: DefinitionSymbol[]): string[] => {
    const signatures = symbols
        .map(buildSymbolSignature)
        .filter((sig): sig is string => Boolean(sig))
        .map(normalizeSignature);
    return Array.from(new Set(signatures)).sort();
};

const buildSymbolSignature = (symbol: DefinitionSymbol): string | undefined => {
    if (symbol.signature) {
        return symbol.signature;
    }
    const params = symbol.parameters?.length ? symbol.parameters.join(", ") : "";
    const returnType = symbol.returnType ? `:${symbol.returnType}` : "";
    if (!params && !returnType) {
        return undefined;
    }
    return `${symbol.name}(${params})${returnType}`;
};

const normalizeSignature = (signature: string): string => {
    return signature.replace(/\s+/g, " ").trim();
};

const setEquals = <T,>(left: Set<T>, right: Set<T>): boolean => {
    if (left.size !== right.size) return false;
    for (const value of left) {
        if (!right.has(value)) return false;
    }
    return true;
};

const arrayEquals = <T,>(left: T[], right: T[]): boolean => {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return false;
    }
    return true;
};
