import { performance } from 'perf_hooks';
import type { ImportInfo, ExportInfo } from '../../indexing/ProjectIndex.js';
import type { SymbolInfo, TopologyInfo } from '../../types.js';
import type { AstDocument } from '../AstBackend.js';
import { QueryProvider } from '../QueryProvider.js';
import { ModuleResolver } from '../ModuleResolver.js';
import { AdaptiveFlowMetrics } from '../../utils/AdaptiveFlowMetrics.js';
import { FeatureFlags } from '../../config/FeatureFlags.js';
import { RegexBackend } from './backends/RegexBackend.js';
import { TreeSitterBackend } from './backends/TreeSitterBackend.js';
import type { ExtractionRequest } from './backends/AstBackend.js';

export interface UnifiedExtractorOptions {
    moduleResolver?: ModuleResolver;
    regexConfidenceThreshold?: number;
}

export interface TopologyExtractionOptions {
    doc?: AstDocument;
    docProvider?: () => Promise<AstDocument>;
    forceBackend?: 'regex' | 'treesitter';
}

export interface ExtractionOptions {
    doc?: AstDocument;
    docProvider?: () => Promise<AstDocument>;
    preferBackend?: 'regex' | 'treesitter';
}

export class UnifiedExtractor {
    private readonly regexBackend: RegexBackend;
    private readonly treeSitterBackend: TreeSitterBackend;
    private readonly regexConfidenceThreshold: number;

    constructor(queryProvider: QueryProvider, options: UnifiedExtractorOptions = {}) {
        this.regexBackend = new RegexBackend(options.moduleResolver);
        this.treeSitterBackend = new TreeSitterBackend(queryProvider, options.moduleResolver);
        this.regexConfidenceThreshold = options.regexConfidenceThreshold ?? 0.95;
    }

    public supportsRegex(languageId: string): boolean {
        return this.regexBackend.supportsLanguage?.(languageId) ?? false;
    }

    public async extractTopology(
        filePath: string,
        content: string,
        languageId: string,
        options: TopologyExtractionOptions = {}
    ): Promise<TopologyInfo> {
        const startTime = performance.now();
        const unifiedEnabled = FeatureFlags.isEnabled(FeatureFlags.UNIFIED_EXTRACTION_ENABLED, FeatureFlags.getContext());
        const hasDoc = Boolean(options.doc || options.docProvider);
        const forceBackend = unifiedEnabled
            ? options.forceBackend
            : (hasDoc ? (options.forceBackend ?? 'treesitter') : options.forceBackend);
        const allowRegex = unifiedEnabled || (!options.doc && !options.docProvider);
        const useRegex = allowRegex && (forceBackend === 'regex'
            || (forceBackend !== 'treesitter' && this.supportsRegex(languageId)));
        let regexResult: TopologyInfo | undefined;

        if (useRegex) {
            regexResult = await this.regexBackend.extractTopology({ filePath, content, languageId });
            if (options.forceBackend === 'regex') {
                AdaptiveFlowMetrics.recordTopologyScan(regexResult.extractionTimeMs, false);
                return regexResult;
            }
            if (!options.doc && !options.docProvider) {
                AdaptiveFlowMetrics.recordTopologyScan(regexResult.extractionTimeMs, false);
                return regexResult;
            }
            if (regexResult.confidence > this.regexConfidenceThreshold) {
                AdaptiveFlowMetrics.recordTopologyScan(regexResult.extractionTimeMs, false);
                return regexResult;
            }
        }

        const { doc, ownsDoc } = await this.ensureDoc(options);
        if (!doc) {
            throw new Error(`Extraction failed: No document provided for TreeSitter and Regex not supported for ${languageId}`);
        }

        try {
            const topology = await this.extractTopologyWithTreeSitter(filePath, content, languageId, doc);
            const duration = performance.now() - startTime;
            const fallbackUsed = Boolean(regexResult);
            AdaptiveFlowMetrics.recordTopologyScan(duration, fallbackUsed);
            return {
                ...topology,
                fallbackUsed,
                extractionTimeMs: duration
            };
        } finally {
            if (ownsDoc) {
                doc.dispose?.();
            }
        }
    }

    public async extractImports(
        filePath: string,
        content: string,
        languageId: string,
        options: ExtractionOptions = {}
    ): Promise<ImportInfo[]> {
        const unifiedEnabled = FeatureFlags.isEnabled(FeatureFlags.UNIFIED_EXTRACTION_ENABLED, FeatureFlags.getContext());
        const allowRegex = unifiedEnabled || (!options.doc && !options.docProvider);
        const preferRegex = allowRegex && (options.preferBackend === 'regex'
            || (options.preferBackend !== 'treesitter' && this.supportsRegex(languageId)));

        if (preferRegex) {
            return this.regexBackend.extractImports({ filePath, content, languageId });
        }

        const { doc, ownsDoc } = await this.ensureDoc(options);
        if (!doc) {
            throw new Error(`Import extraction failed: No document provided for TreeSitter (${languageId}).`);
        }
        try {
            return await this.treeSitterBackend.extractImports({ filePath, content, languageId, doc });
        } finally {
            if (ownsDoc) {
                doc.dispose?.();
            }
        }
    }

    public async extractExports(
        filePath: string,
        content: string,
        languageId: string,
        options: ExtractionOptions = {}
    ): Promise<ExportInfo[]> {
        const unifiedEnabled = FeatureFlags.isEnabled(FeatureFlags.UNIFIED_EXTRACTION_ENABLED, FeatureFlags.getContext());
        const allowRegex = unifiedEnabled || (!options.doc && !options.docProvider);
        const preferRegex = allowRegex && (options.preferBackend === 'regex'
            || (options.preferBackend !== 'treesitter' && this.supportsRegex(languageId)));

        if (preferRegex) {
            return this.regexBackend.extractExports({ filePath, content, languageId });
        }

        const { doc, ownsDoc } = await this.ensureDoc(options);
        if (!doc) {
            throw new Error(`Export extraction failed: No document provided for TreeSitter (${languageId}).`);
        }
        try {
            return await this.treeSitterBackend.extractExports({ filePath, content, languageId, doc });
        } finally {
            if (ownsDoc) {
                doc.dispose?.();
            }
        }
    }

    public async extractSymbols(
        filePath: string,
        content: string,
        languageId: string,
        options: ExtractionOptions = {}
    ): Promise<SymbolInfo[]> {
        const { doc, ownsDoc } = await this.ensureDoc(options);
        if (!doc) {
            throw new Error(`Symbol extraction failed: No document provided for TreeSitter (${languageId}).`);
        }
        try {
            return await this.treeSitterBackend.extractSymbols({ filePath, content, languageId, doc });
        } finally {
            if (ownsDoc) {
                doc.dispose?.();
            }
        }
    }

    private async extractTopologyWithTreeSitter(
        filePath: string,
        content: string,
        languageId: string,
        doc: AstDocument
    ): Promise<TopologyInfo> {
        const request: ExtractionRequest = { filePath, content, languageId, doc };
        const [imports, exports, symbols] = await Promise.all([
            this.treeSitterBackend.extractImports(request),
            this.treeSitterBackend.extractExports(request),
            this.treeSitterBackend.extractSymbols(request)
        ]);

        return this.buildTopology(filePath, imports, exports, symbols);
    }

    private buildTopology(
        filePath: string,
        imports: ImportInfo[],
        exports: ExportInfo[],
        symbols: SymbolInfo[]
    ): TopologyInfo {
        const exportNames = new Set(exports.map(exp => exp.name));
        const topLevelSymbols = symbols
            .filter(symbol => symbol.type !== 'import' && symbol.type !== 'export')
            .map(symbol => ({
                name: symbol.name,
                kind: this.mapSymbolKind(symbol),
                exported: exportNames.has(symbol.name),
                lineNumber: (symbol.range?.startLine ?? 0) + 1,
                level: symbol.level
            }));

        return {
            path: filePath,
            imports: imports.map(imp => ({
                name: imp.what?.[0],
                source: imp.specifier,
                isDefault: imp.importType === 'default',
                namedImports: imp.what ?? [],
                isTypeOnly: false,
                isDynamic: false,
                lineNumber: imp.line
            })) as any,
            exports: exports.map(exp => ({
                name: exp.name,
                isDefault: exp.exportType === 'default',
                isTypeOnly: false,
                reExportFrom: exp.isReExport ? exp.reExportFrom : undefined
            })),
            topLevelSymbols,
            confidence: 1.0,
            fallbackUsed: false,
            extractionTimeMs: 0
        };
    }

    private mapSymbolKind(symbol: SymbolInfo): TopologyInfo['topLevelSymbols'][number]['kind'] {
        const symbolType = symbol.type as string;
        if (symbolType === 'class' || symbolType === 'function' || symbolType === 'interface') {
            return symbolType;
        }
        if (symbolType === 'const' || symbolType === 'let' || symbolType === 'var' || symbolType === 'heading') {
            return symbolType as TopologyInfo['topLevelSymbols'][number]['kind'];
        }
        if (symbolType === 'type' || symbolType === 'type_alias') {
            return 'type';
        }
        if (symbolType === 'variable') {
            return 'var';
        }
        return 'function';
    }

    private async ensureDoc(options: { doc?: AstDocument; docProvider?: () => Promise<AstDocument> }): Promise<{ doc?: AstDocument; ownsDoc: boolean }> {
        if (options.doc) {
            return { doc: options.doc, ownsDoc: false };
        }
        if (!options.docProvider) {
            return { doc: undefined, ownsDoc: false };
        }
        const doc = await options.docProvider();
        return { doc, ownsDoc: true };
    }
}
