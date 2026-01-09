import type { AstDocument } from '../../AstBackend.js';
import type { ImportInfo, ExportInfo } from '../../../indexing/ProjectIndex.js';
import type { SymbolInfo } from '../../../types.js';

export interface ExtractionRequest {
    filePath: string;
    content: string;
    languageId?: string;
    doc?: AstDocument;
}

export interface ExtractionBackend {
    name: string;
    supportsLanguage?(languageId: string): boolean;
    extractImports(request: ExtractionRequest): Promise<ImportInfo[]>;
    extractExports(request: ExtractionRequest): Promise<ExportInfo[]>;
    extractSymbols(request: ExtractionRequest): Promise<SymbolInfo[]>;
}
