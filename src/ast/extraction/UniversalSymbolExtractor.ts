import { QueryProvider } from '../QueryProvider.js';
import { AstDocument } from '../AstBackend.js';
import { SymbolInfo, DefinitionSymbol } from '../../types.js';
import { DocumentationExtractor } from './DocumentationExtractor.js';
import { CallSiteAnalyzer } from '../analysis/CallSiteAnalyzer.js';

export class UniversalSymbolExtractor {
    private docExtractor = new DocumentationExtractor();
    private callSiteAnalyzer = new CallSiteAnalyzer();

    constructor(private queryProvider: QueryProvider) {}

    public async extract(doc: AstDocument, languageId: string): Promise<SymbolInfo[]> {
        const treeLanguage = (doc as any)?.rootNode?.tree?.language;
        if (!treeLanguage) {
            return this.extractByRegex(doc.content ?? '', languageId);
        }
        const query = await this.queryProvider.getQuery(treeLanguage, languageId, 'symbols');
        if (!query) {
            return this.extractByRegex(doc.content ?? '', languageId);
        }

        const matches = query.matches(doc.rootNode);
        const symbols: SymbolInfo[] = [];
        const definitionNodeMap = new Map<string, DefinitionSymbol>();

        for (const match of matches) {
            const levelCapture = match.captures.find(c => c.name.startsWith('symbol.level') || c.name.startsWith('heading.level'));
            const hasLegacyName = match.captures.some(c => c.name === 'export.name');
            let level: number | undefined;
            if (levelCapture) {
                const levelStr = levelCapture.name.replace('symbol.level', '').replace('heading.level', '');
                level = parseInt(levelStr, 10);
                if (isNaN(level)) level = undefined;
            }

            for (const capture of match.captures) {
                const name = capture.name;
                let type: any;

                if (name === 'export.name') {
                    const typeCapture = match.captures.find(c => c.name === 'export.type');
                    type = typeCapture ? (typeCapture.node.text as SymbolInfo['type']) : 'function';
                    if (level !== undefined) {
                        type = 'heading';
                    }
                } else if (name === 'class') {
                    type = 'class';
                } else if (name === 'function') {
                    type = 'function';
                } else if (name === 'method') {
                    type = 'method';
                } else if (name === 'interface') {
                    type = 'interface';
                } else if (name === 'type') {
                    type = 'type_alias';
                } else if (name === 'const') {
                    type = 'variable';
                } else if (name === 'let') {
                    type = 'variable';
                } else if (name === 'var' || name === 'variable') {
                    type = 'variable';
                } else if (!hasLegacyName && (name === 'heading' || name.startsWith('heading.level') || name.startsWith('symbol.level'))) {
                    type = 'heading';
                }

                if (!type) continue;

                const resolvedLevel = type === 'heading' ? level : undefined;

                // Enhanced metadata extraction for DefinitionSymbols
                const isDefinition = ['class', 'function', 'method', 'interface', 'type_alias'].includes(type);
                const rangeNode = isDefinition ? (capture.node.parent ?? capture.node) : capture.node;
                let extra: Partial<DefinitionSymbol> = {};

                if (isDefinition) {
                    const container = this.findContainerName(rangeNode);
                    extra = {
                        parameters: this.docExtractor.extractParameterNames(rangeNode),
                        returnType: this.docExtractor.extractReturnType(rangeNode),
                        doc: this.docExtractor.extractDocumentation(rangeNode, languageId),
                        modifiers: this.extractModifiers(rangeNode),
                        signature: this.extractSignature(rangeNode, languageId),
                        container
                    };
                }
                const symbol = {
                    name: capture.node.text,
                    type: type as any,
                    level: resolvedLevel,
                    range: {
                        startLine: rangeNode.startPosition.row,
                        endLine: rangeNode.endPosition.row,
                        startByte: rangeNode.startIndex,
                        endByte: rangeNode.endIndex
                    },
                    ...extra
                } as DefinitionSymbol;
                symbols.push(symbol);
                if (isDefinition) {
                    definitionNodeMap.set(this.makeNodeKey(rangeNode), symbol);
                }
            }
        }

        if (definitionNodeMap.size > 0 && treeLanguage) {
            this.callSiteAnalyzer.attachCallSiteMetadata(
                doc.rootNode,
                treeLanguage,
                languageId,
                definitionNodeMap
            );
        }

        return symbols;
    }

    private extractByRegex(content: string, languageId: string): SymbolInfo[] {
        if (!content.trim()) return [];
        if (!['typescript', 'tsx', 'javascript', 'jsx'].includes(languageId)) {
            return [];
        }

        const symbols: SymbolInfo[] = [];
        const lineOffsets = this.computeLineOffsets(content);
        const pushSymbol = (matchIndex: number, matchText: string, type: DefinitionSymbol['type'], name: string) => {
            const range = this.computeRange(matchIndex, matchText, lineOffsets);
            symbols.push({
                name,
                type,
                range,
                content: matchText
            } as DefinitionSymbol);
        };

        const patterns: Array<{ regex: RegExp; type: DefinitionSymbol['type']; group: number }> = [
            { regex: /\bclass\s+([A-Za-z_$][\w$]*)/g, type: 'class', group: 1 },
            { regex: /\binterface\s+([A-Za-z_$][\w$]*)/g, type: 'interface', group: 1 },
            { regex: /\btype\s+([A-Za-z_$][\w$]*)\s*=/g, type: 'type_alias', group: 1 },
            { regex: /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g, type: 'function', group: 1 },
            { regex: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/g, type: 'variable', group: 1 }
        ];

        for (const pattern of patterns) {
            let match: RegExpExecArray | null;
            while ((match = pattern.regex.exec(content)) !== null) {
                const name = match[pattern.group];
                if (!name) continue;
                pushSymbol(match.index, match[0], pattern.type, name);
            }
        }

        return symbols;
    }

    private computeLineOffsets(content: string): number[] {
        const offsets = [0];
        for (let i = 0; i < content.length; i += 1) {
            if (content[i] === '\n') {
                offsets.push(i + 1);
            }
        }
        return offsets;
    }

    private computeRange(start: number, text: string, lineOffsets: number[]) {
        const end = start + text.length;
        const startLine = this.offsetToLine(start, lineOffsets);
        const endLine = this.offsetToLine(Math.max(start, end - 1), lineOffsets);
        return {
            startLine,
            endLine,
            startByte: start,
            endByte: end
        };
    }

    private offsetToLine(offset: number, lineOffsets: number[]): number {
        let low = 0;
        let high = lineOffsets.length - 1;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (lineOffsets[mid] <= offset) {
                if (mid === lineOffsets.length - 1 || lineOffsets[mid + 1] > offset) {
                    return mid;
                }
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return 0;
    }

    private extractModifiers(node: any): string[] {
        const modifiers: string[] = [];
        let p = node.parent;
        if (p && (p.type === 'export_statement')) {
            modifiers.push('export');
            if (p.children.some((c: any) => c.type === 'default')) modifiers.push('default');
        }
        
        if (node.children) {
            for (const child of node.children) {
                if (child.type.includes('modifier') || child.type === 'static') {
                    modifiers.push(child.text);
                }
            }
        }
        return modifiers;
    }

    private extractSignature(node: any, languageId: string): string | undefined {
        if (!node?.text) return undefined;
        const line = node.text.split(/\r?\n/)[0]?.trim();
        if (!line) return undefined;
        if (languageId === 'python') {
            return line.replace(/:\s*$/, '');
        }
        return line.replace(/\s*\{.*$/, '').trim();
    }

    private findContainerName(node: any): string | undefined {
        let current = node.parent;
        while (current) {
            if (current.type === 'class_declaration' || current.type === 'class_definition') {
                const nameNode = current.childForFieldName?.('name');
                if (nameNode?.text) return nameNode.text;
            }
            if (current.type === 'interface_declaration') {
                const nameNode = current.childForFieldName?.('name');
                if (nameNode?.text) return nameNode.text;
            }
            current = current.parent;
        }
        return undefined;
    }

    private makeNodeKey(node: any): string {
        const start = typeof node.startIndex === 'number' ? node.startIndex : 0;
        const end = typeof node.endIndex === 'number' ? node.endIndex : start;
        const idPart = typeof node.id === 'number' || typeof node.id === 'string'
            ? String(node.id)
            : '';
        return `${idPart}:${start}:${end}`;
    }
}
