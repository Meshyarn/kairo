import { QueryProvider } from '../QueryProvider.js';
import { AstDocument } from '../AstBackend.js';
import { ImportSymbol } from '../../types.js';
import { UniversalFallbackExtractor } from './UniversalFallbackExtractor.js';

export class UniversalImportExtractor {
    private readonly fallbackExtractor = new UniversalFallbackExtractor();

    constructor(private queryProvider: QueryProvider) {}

    public async extract(doc: AstDocument, languageId: string): Promise<ImportSymbol[]> {
        const query = await this.queryProvider.getQuery(doc.rootNode.tree.language, languageId, 'imports');
        const resultsMap = new Map<string, ImportSymbol>();
        const parsed = new Set<string>();

        if (query) {
            const matches = query.matches(doc.rootNode);
            for (const match of matches) {
                const importNode = match.captures.find(c => c.name === 'import' || c.name === 'import.node')?.node;
                if (!importNode) continue;

                const rangeKey = `${importNode.startIndex}:${importNode.endIndex}`;
                let symbol = resultsMap.get(rangeKey);

                if (!symbol) {
                    symbol = {
                        type: 'import',
                        name: '',
                        source: '',
                        importKind: 'named',
                        imports: [],
                        range: {
                            startLine: importNode.startPosition.row,
                            endLine: importNode.endPosition.row,
                            startByte: importNode.startIndex,
                            endByte: importNode.endIndex
                        }
                    } as ImportSymbol;
                    resultsMap.set(rangeKey, symbol);
                }

                let lastImport: { name: string; alias?: string } | null = null;
                for (const capture of match.captures) {
                    if (capture.name === 'source' || capture.name === 'import.path') {
                        symbol.source = capture.node.text.replace(/['"]/g, '');
                    } else if (capture.name === 'name' || capture.name === 'import.name') {
                        const entry = { name: capture.node.text };
                        symbol.imports?.push(entry);
                        lastImport = entry;
                        if (!symbol.name) {
                            symbol.name = capture.node.text;
                        }
                    } else if (capture.name === 'alias' || capture.name === 'import.alias') {
                        if (lastImport) {
                            lastImport.alias = capture.node.text;
                        } else {
                            symbol.alias = capture.node.text;
                        }
                    } else if (capture.name === 'default' || capture.name === 'import.default') {
                        symbol.importKind = 'default';
                        if (!symbol.name) {
                            symbol.name = capture.node.text || 'default';
                        }
                    } else if (capture.name === 'namespace' || capture.name === 'import.namespace') {
                        symbol.importKind = 'namespace';
                    } else if (capture.name === 'type' || capture.name === 'import.type') {
                        symbol.isTypeOnly = true;
                    }
                }

                if (!symbol.name && symbol.importKind === 'default' && symbol.imports?.length) {
                    symbol.name = symbol.imports[0].name;
                }

                if (this.shouldParseImportText(languageId) && !parsed.has(rangeKey)) {
                    const parsedDetails = this.parseTypescriptImport(importNode.text ?? '');
                    if (parsedDetails) {
                        symbol.source = parsedDetails.source ?? symbol.source;
                        symbol.importKind = parsedDetails.importKind ?? symbol.importKind;
                        symbol.imports = parsedDetails.imports ?? symbol.imports;
                        symbol.alias = parsedDetails.alias ?? symbol.alias;
                        symbol.name = parsedDetails.name ?? symbol.name;
                        symbol.isTypeOnly = parsedDetails.isTypeOnly ?? symbol.isTypeOnly;
                    }
                    parsed.add(rangeKey);
                }
            }
        }

        const queryResults = Array.from(resultsMap.values());

        if (languageId === 'markdown' || languageId === 'md') {
            const merged = new Map<string, ImportSymbol>();
            const addEntry = (entry: ImportSymbol) => {
                const key = `${entry.source}:${entry.name}:${entry.range.startLine}`;
                if (!merged.has(key)) {
                    merged.set(key, entry);
                }
            };
            for (const entry of queryResults) addEntry(entry);
            const regexResults = this.extractMarkdownLinks(doc.content || '');
            for (const entry of regexResults) addEntry(entry);
            return Array.from(merged.values());
        }

        if (queryResults.length === 0 && doc.content) {
            const fallback = this.fallbackExtractor.extractImports(doc.content, languageId);
            if (fallback.length > 0) {
                return fallback;
            }
        }

        return queryResults;
    }

    private shouldParseImportText(languageId: string): boolean {
        return languageId === 'typescript'
            || languageId === 'tsx'
            || languageId === 'javascript'
            || languageId === 'jsx';
    }

    private parseTypescriptImport(text: string): Partial<ImportSymbol> | null {
        const trimmed = text.trim().replace(/;$/, '');
        if (!trimmed.startsWith('import')) return null;
        const isTypeOnly = /^import\s+type\b/.test(trimmed);
        const withoutImport = trimmed
            .replace(/^import\s+type\b\s*/u, '')
            .replace(/^import\s*/u, '');

        const fromMatch = withoutImport.match(/\s+from\s+['"]([^'"]+)['"]/u);
        if (!fromMatch) {
            const sideEffectMatch = withoutImport.match(/['"]([^'"]+)['"]/);
            if (!sideEffectMatch) return null;
            return {
                source: sideEffectMatch[1],
                importKind: 'side-effect',
                imports: [],
                isTypeOnly
            };
        }

        const clause = withoutImport.slice(0, fromMatch.index).trim();
        const source = fromMatch[1].replace(/;$/, '').trim();

        if (clause.startsWith('* as ')) {
            return {
                source,
                importKind: 'namespace',
                alias: clause.replace('* as ', '').trim(),
                imports: [],
                isTypeOnly
            };
        }

        if (clause.startsWith('{')) {
            return {
                source,
                importKind: 'named',
                imports: this.parseNamedSpecifiers(clause),
                isTypeOnly
            };
        }

        if (clause.includes(',')) {
            const [defaultPart, rest] = clause.split(',', 2);
            const defaultName = defaultPart.trim();
            const details: Partial<ImportSymbol> = {
                source,
                importKind: 'default',
                name: defaultName,
                alias: defaultName,
                isTypeOnly
            };
            const restTrimmed = rest.trim();
            if (restTrimmed.startsWith('{')) {
                details.imports = this.parseNamedSpecifiers(restTrimmed);
            } else if (restTrimmed.startsWith('* as ')) {
                details.importKind = 'namespace';
                details.alias = restTrimmed.replace('* as ', '').trim();
            }
            return details;
        }

        return {
            source,
            importKind: 'default',
            name: clause.trim(),
            alias: clause.trim(),
            isTypeOnly
        };
    }

    private parseNamedSpecifiers(text: string): Array<{ name: string; alias?: string }> {
        const trimmed = text.trim();
        const inner = trimmed.replace(/^{/, '').replace(/}$/, '');
        if (!inner.trim()) return [];
        return inner.split(',').map(part => {
            const entry = part.trim();
            if (!entry) return null;
            const [name, alias] = entry.split(/\s+as\s+/u).map(item => item.trim());
            return alias ? { name, alias } : { name };
        }).filter((item): item is { name: string; alias?: string } => Boolean(item));
    }

    private extractMarkdownLinks(text: string): ImportSymbol[] {
        if (!text) return [];
        const results: ImportSymbol[] = [];
        const lines = text.split(/\r?\n/);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Inline links: [Link Text](url)
            const inlineRegex = /(!?)\[([^\]]+)\]\(([^)]+)\)/g;
            let match;
            while ((match = inlineRegex.exec(line)) !== null) {
                if (match[1] === '!') continue; 
                results.push({
                    type: 'import',
                    name: match[2],
                    source: match[3],
                    importKind: 'named',
                    range: {
                        startLine: i,
                        endLine: i,
                        startByte: match.index,
                        endByte: match.index + match[0].length
                    }
                } as ImportSymbol);
            }

            // Reference definition: [id]: url
            const refRegex = /^\[([^\]]+)\]:\s*(\S+)/;
            const refMatch = line.match(refRegex);
            if (refMatch) {
                results.push({
                    type: 'import',
                    name: refMatch[1],
                    source: refMatch[2],
                    importKind: 'named',
                    range: {
                        startLine: i,
                        endLine: i,
                        startByte: 0,
                        endByte: line.length
                    }
                } as ImportSymbol);
            }
        }
        return results;
    }
}
