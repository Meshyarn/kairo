import { QueryProvider } from '../QueryProvider.js';
import { AstDocument } from '../AstBackend.js';
import { ExportSymbol } from '../../types.js';

export class UniversalExportExtractor {
    constructor(private queryProvider: QueryProvider) {}

    public async extract(doc: AstDocument, languageId: string): Promise<ExportSymbol[]> {
        const query = await this.queryProvider.getQuery(doc.rootNode.tree.language, languageId, 'exports');
        if (!query) return [];

        const resultsMap = new Map<string, ExportSymbol>();
        const parsed = new Set<string>();
        const matches = query.matches(doc.rootNode);

        for (const match of matches) {
            const exportNode = match.captures.find(c => c.name === 'export' || c.name === 'export.node')?.node;
            if (!exportNode) continue;

            const rangeKey = `${exportNode.startIndex}:${exportNode.endIndex}`;
            let symbol = resultsMap.get(rangeKey);
            if (!symbol) {
                symbol = {
                    type: 'export',
                    name: '',
                    exportKind: 'named',
                    range: {
                        startLine: exportNode.startPosition.row,
                        endLine: exportNode.endPosition.row,
                        startByte: exportNode.startIndex,
                        endByte: exportNode.endIndex
                    }
                };
                resultsMap.set(rangeKey, symbol);
            }

            for (const capture of match.captures) {
                if (capture.name === 'name' || capture.name === 'export.name') {
                    symbol.name = capture.node.text;
                    if (!symbol.exports) {
                        symbol.exports = [];
                    }
                    symbol.exports.push({ name: capture.node.text });
                } else if (capture.name === 'default' || capture.name === 'export.default') {
                    symbol.exportKind = 'default';
                    if (!symbol.name) symbol.name = capture.node.text || 'default';
                } else if (capture.name === 'namespace' || capture.name === 'export.namespace') {
                    symbol.exportKind = 'namespace';
                } else if (capture.name === 'reexport' || capture.name === 'export.reexport') {
                    symbol.exportKind = 're-export';
                } else if (capture.name === 'source' || capture.name === 'export.source') {
                    symbol.source = capture.node.text.replace(/['"]/g, '');
                } else if (capture.name === 'type' || capture.name === 'export.type') {
                    symbol.isTypeOnly = true;
                }
            }

            if (this.shouldParseExportText(languageId) && !parsed.has(rangeKey)) {
                const parsedDetails = this.parseTypescriptExport(exportNode.text ?? '');
                if (parsedDetails) {
                    symbol.name = parsedDetails.name ?? symbol.name;
                    symbol.exportKind = parsedDetails.exportKind ?? symbol.exportKind;
                    symbol.source = parsedDetails.source ?? symbol.source;
                    symbol.exports = parsedDetails.exports ?? symbol.exports;
                    symbol.isTypeOnly = parsedDetails.isTypeOnly ?? symbol.isTypeOnly;
                }
                parsed.add(rangeKey);
            }
        }

        return Array.from(resultsMap.values());
    }

    private shouldParseExportText(languageId: string): boolean {
        return languageId === 'typescript'
            || languageId === 'tsx'
            || languageId === 'javascript'
            || languageId === 'jsx';
    }

    private parseTypescriptExport(text: string): Partial<ExportSymbol> | null {
        const trimmed = text.trim().replace(/;$/, '');
        if (!trimmed.startsWith('export')) return null;
        const isTypeOnly = /^export\s+type\b/.test(trimmed);
        const sourceMatch = trimmed.match(/\sfrom\s+['"]([^'"]+)['"]/);
        const source = sourceMatch?.[1];

        if (/^export\s+default\b/.test(trimmed)) {
            const classMatch = trimmed.match(/^export\s+default\s+class\s+([A-Za-z_][A-Za-z0-9_]*)/);
            const functionMatch = trimmed.match(/^export\s+default\s+function\s+([A-Za-z_][A-Za-z0-9_]*)/);
            const nameMatch = trimmed.match(/^export\s+default\s+([A-Za-z_][A-Za-z0-9_]*)/);
            return {
                exportKind: 'default',
                name: classMatch?.[1] || functionMatch?.[1] || nameMatch?.[1] || 'default',
                source,
                isTypeOnly
            };
        }

        if (/^export\s+\*/.test(trimmed)) {
            return {
                exportKind: 're-export',
                name: '*',
                source,
                isTypeOnly
            };
        }

        const braceMatch = trimmed.match(/export\s+(type\s+)?\{([^}]*)\}/);
        if (braceMatch) {
            const entries = braceMatch[2].split(',').map(part => part.trim()).filter(Boolean);
            const exports = entries.map(entry => {
                const [name, alias] = entry.split(/\s+as\s+/u).map(item => item.trim());
                return alias ? { name, alias } : { name };
            });
            const exportKind = source ? 're-export' : 'named';
            return {
                exportKind,
                name: exportKind === 'named' ? 'local exports' : 're-export',
                source,
                exports,
                isTypeOnly
            };
        }

        const declMatch = trimmed.match(/^export\s+(const|let|var|function|class|interface|type|enum)\b\s*([A-Za-z_][A-Za-z0-9_]*)?/);
        if (declMatch) {
            const name = declMatch[2];
            return {
                exportKind: 'named',
                name: 'local exports',
                exports: name ? [{ name }] : [],
                isTypeOnly: isTypeOnly || declMatch[1] === 'type',
                source
            };
        }

        return null;
    }
}
