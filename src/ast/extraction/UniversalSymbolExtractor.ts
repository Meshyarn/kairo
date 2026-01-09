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
        const query = await this.queryProvider.getQuery(doc.rootNode.tree.language, languageId, 'symbols');
        if (!query) return [];

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

        if (definitionNodeMap.size > 0) {
            this.callSiteAnalyzer.attachCallSiteMetadata(
                doc.rootNode,
                doc.rootNode.tree.language,
                languageId,
                definitionNodeMap
            );
        }

        return symbols;
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
