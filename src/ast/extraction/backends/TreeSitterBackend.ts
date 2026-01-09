import type { ExtractionBackend, ExtractionRequest } from './AstBackend.js';
import type { ImportInfo, ExportInfo } from '../../../indexing/ProjectIndex.js';
import type { SymbolInfo, ImportSymbol, ExportSymbol } from '../../../types.js';
import type { AstDocument } from '../../AstBackend.js';
import { QueryProvider } from '../../QueryProvider.js';
import { ModuleResolver } from '../../ModuleResolver.js';
import { UniversalImportExtractor } from '../UniversalImportExtractor.js';
import { UniversalExportExtractor } from '../UniversalExportExtractor.js';
import { UniversalSymbolExtractor } from '../UniversalSymbolExtractor.js';

export class TreeSitterBackend implements ExtractionBackend {
    public readonly name = 'treesitter';
    private importExtractor: UniversalImportExtractor;
    private exportExtractor: UniversalExportExtractor;
    private symbolExtractor: UniversalSymbolExtractor;

    constructor(queryProvider: QueryProvider, private readonly moduleResolver?: ModuleResolver) {
        this.importExtractor = new UniversalImportExtractor(queryProvider);
        this.exportExtractor = new UniversalExportExtractor(queryProvider);
        this.symbolExtractor = new UniversalSymbolExtractor(queryProvider);
    }

    public async extractImports(request: ExtractionRequest): Promise<ImportInfo[]> {
        const doc = this.requireDoc(request);
        const languageId = this.requireLanguage(request);
        const symbols = await this.importExtractor.extract(doc, languageId);
        return symbols
            .map(symbol => this.toImportInfo(request.filePath, symbol))
            .filter((entry): entry is ImportInfo => Boolean(entry));
    }

    public async extractExports(request: ExtractionRequest): Promise<ExportInfo[]> {
        const doc = this.requireDoc(request);
        const languageId = this.requireLanguage(request);
        const symbols = await this.exportExtractor.extract(doc, languageId);
        return symbols
            .map(symbol => this.toExportInfo(request.filePath, symbol))
            .filter((entry): entry is ExportInfo => Boolean(entry));
    }

    public async extractSymbols(request: ExtractionRequest): Promise<SymbolInfo[]> {
        const doc = this.requireDoc(request);
        const languageId = this.requireLanguage(request);
        return this.symbolExtractor.extract(doc, languageId);
    }

    private requireDoc(request: ExtractionRequest): AstDocument {
        if (!request.doc) {
            throw new Error('TreeSitter backend requires an AST document.');
        }
        return request.doc;
    }

    private requireLanguage(request: ExtractionRequest): string {
        if (!request.languageId) {
            throw new Error('TreeSitter backend requires a languageId.');
        }
        return request.languageId;
    }

    private toImportInfo(filePath: string, symbol: ImportSymbol): ImportInfo | null {
        if (!symbol.source) {
            return null;
        }

        const importType = this.mapImportKind(symbol);
        const line = symbol.range?.startLine !== undefined ? symbol.range.startLine + 1 : 0;
        const what = this.collectImportNames(symbol, importType);

        return {
            specifier: symbol.source,
            resolvedPath: this.resolve(filePath, symbol.source),
            what,
            line,
            importType
        };
    }

    private toExportInfo(filePath: string, symbol: ExportSymbol): ExportInfo | null {
        const name = symbol.name || (symbol.exportKind === 'default' ? 'default' : '*');
        const line = symbol.range?.startLine !== undefined ? symbol.range.startLine + 1 : 0;
        const exportType = symbol.exportKind === 'default' ? 'default' : 'named';
        const isReExport = symbol.exportKind === 're-export' || Boolean(symbol.source);

        return {
            name,
            exportType,
            line,
            isReExport,
            reExportFrom: isReExport && symbol.source ? this.resolve(filePath, symbol.source) : undefined
        };
    }

    private mapImportKind(symbol: ImportSymbol): ImportInfo['importType'] {
        switch (symbol.importKind) {
            case 'default':
                return 'default';
            case 'namespace':
                return 'namespace';
            case 'side-effect':
                return 'side-effect';
            default:
                return 'named';
        }
    }

    private collectImportNames(symbol: ImportSymbol, importType: ImportInfo['importType']): string[] {
        if (importType === 'side-effect') {
            return [];
        }
        if (importType === 'namespace') {
            return ['*'];
        }
        const names = (symbol.imports ?? [])
            .map(entry => entry.alias ?? entry.name)
            .filter(Boolean);
        if (names.length === 0 && symbol.name) {
            names.push(symbol.name);
        }
        return names;
    }

    private resolve(contextPath: string, specifier: string): string | undefined {
        if (!this.moduleResolver) return undefined;
        return this.moduleResolver.resolve(contextPath, specifier) ?? undefined;
    }
}
