import { QueryProvider } from '../QueryProvider.js';
import { AstDocument } from '../AstBackend.js';
import { SkeletonOptions, SkeletonDetailLevel } from '../../types.js';
import { Query } from 'web-tree-sitter';

type ResolvedSkeletonOptions = {
    includeMemberVars: boolean;
    includeComments: boolean;
    includeSummary: boolean;
    useCommentPlaceholder: boolean;
    detailLevel: SkeletonDetailLevel;
    maxMemberPreview: number;
};

export class UniversalSkeletonGenerator {
    constructor(private queryProvider: QueryProvider) {}

    public async generate(doc: AstDocument, languageId: string, options: SkeletonOptions = {}): Promise<string> {
        const lang = doc.rootNode.tree.language;
        const query = await this.queryProvider.getQuery(lang, languageId, 'skeleton');
        
        let resolvedOptions = this.resolveOptions(options);
        resolvedOptions = this.applyAutoDetailLevel(resolvedOptions, options, doc.rootNode.text);

        if (!query) return doc.rootNode.text;

        const matches = query.matches(doc.rootNode);
        const folds: { start: number, end: number, replacement?: string }[] = [];

        for (const match of matches) {
            for (const capture of match.captures) {
                if (capture.name === 'skeleton.fold') {
                    const node = capture.node;
                    if (this.shouldFoldByDetailLevel(node, resolvedOptions.detailLevel, doc.rootNode.text, languageId)) {
                        const summary = resolvedOptions.includeSummary
                            ? await this.generateSemanticSummary(node, lang, languageId)
                            : null;
                        const range = this.resolveFoldRange(node, doc.rootNode.text, languageId);
                        const replacement = this.buildFoldReplacement(
                            languageId,
                            summary,
                            resolvedOptions.useCommentPlaceholder
                        );

                        folds.push({ 
                            start: range.start,
                            end: range.end,
                            replacement
                        });
                    }
                }
            }
        }

        const filteredFolds = this.filterNestedFolds(folds);
        filteredFolds.sort((a, b) => b.start - a.start);

        let result = doc.rootNode.text;
        for (const fold of filteredFolds) {
            result = result.substring(0, fold.start) + (fold.replacement ?? ' { ... }') + result.substring(fold.end);
        }

        return this.applySkeletonPostProcessing(result, resolvedOptions, languageId);
    }

    public async findIdentifiers(doc: AstDocument, languageId: string, targetNames: string[]): Promise<{ name: string, range: any }[]> {
        const lang = doc.rootNode.tree.language;
        const query = new Query(lang, `
            (identifier) @id
            (property_identifier) @id
            (type_identifier) @id
            (shorthand_property_identifier_pattern) @id
        `);

        const matches = query.matches(doc.rootNode);
        const targetSet = new Set(targetNames);
        const results: { name: string, range: any }[] = [];

        for (const match of matches) {
            const node = match.captures[0].node;
            if (targetSet.has(node.text)) {
                results.push({
                    name: node.text,
                    range: {
                        startLine: node.startPosition.row,
                        endLine: node.endPosition.row,
                        startByte: node.startIndex,
                        endByte: node.endIndex
                    }
                });
            }
        }
        return results;
    }

    private resolveOptions(options: SkeletonOptions): ResolvedSkeletonOptions {
        return {
            includeMemberVars: options.includeMemberVars ?? true,
            includeComments: options.includeComments ?? false,
            includeSummary: options.includeSummary ?? false,
            useCommentPlaceholder: options.useCommentPlaceholder ?? false,
            detailLevel: options.detailLevel ?? 'standard',
            maxMemberPreview: Math.max(1, options.maxMemberPreview ?? 3)
        };
    }

    private applyAutoDetailLevel(
        resolved: ResolvedSkeletonOptions,
        options: SkeletonOptions,
        content: string
    ): ResolvedSkeletonOptions {
        if (options.detailLevel !== undefined) return resolved;
        const thresholdRaw = process.env.KAIRO_SKELETON_AUTO_MINIMAL_LINES;
        const threshold = thresholdRaw ? Number.parseInt(thresholdRaw, 10) : 500;
        if (!Number.isFinite(threshold) || threshold <= 0) return resolved;
        const lineCount = content.split(/\r?\n/).length;
        if (lineCount < threshold) return resolved;
        return {
            ...resolved,
            detailLevel: "minimal",
            includeMemberVars: options.includeMemberVars ?? false
        };
    }

    private shouldFoldByDetailLevel(
        node: any,
        detailLevel: SkeletonDetailLevel,
        content: string,
        languageId: string
    ): boolean {
        const slice = content.substring(node.startIndex, node.endIndex);
        const lineLength = slice.split(/\r?\n/).length;
        
        if (detailLevel === 'detailed') {
            return lineLength > 20;
        }
        if (detailLevel === 'minimal') {
            return true;
        }
        const minLines = languageId === 'python' ? 1 : 3;
        return lineLength >= minLines;
    }

    private async generateSemanticSummary(node: any, lang: any, languageId: string): Promise<string | null> {
        try {
            const slice = node.text || "";
            const cleanedLines = slice
                .split(/\r?\n/)
                .map((line: string) => line.trim())
                .filter((line: string) => line && !/^[{}]+;?$/.test(line));
            const callNames = this.extractCallNames(slice);
            const branchPattern = /\\b(if|else|for|while|case|catch|&&|\\|\\|)\\b/g;
            const branches = (slice.match(branchPattern) || []).length;
            const loc = Math.max(1, cleanedLines.length - callNames.length);
            const callsSummary = callNames.length ? `calls: ${callNames.join(', ')}` : 'calls: none';
            return `${callsSummary}; complexity: ${loc} LOC, ${branches} branches`;
        } catch {
            return null;
        }
    }

    private applySkeletonPostProcessing(content: string, options: ResolvedSkeletonOptions, languageId: string): string {
        const lines = content.split(/\r?\n/);
        const processed: string[] = [];
        let braceDepth = 0;
        const classDepths: number[] = [];
        let pendingClass = false;

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === "") continue;
            if (!options.includeComments && this.isCommentText(trimmed, languageId)) {
                if (!(options.useCommentPlaceholder && this.isSkeletonPlaceholder(trimmed))) {
                    continue;
                }
            }
            const preDepth = braceDepth;
            if (this.isClassDeclarationLine(trimmed, languageId)) {
                pendingClass = true;
            }
            const inClassBody = classDepths.length > 0 && preDepth === classDepths[classDepths.length - 1];
            if (!options.includeMemberVars && inClassBody && this.isMemberVariableLine(trimmed, languageId)) {
                braceDepth = this.updateBraceDepth(line, braceDepth);
                if (pendingClass && line.includes('{')) {
                    classDepths.push(preDepth + 1);
                    pendingClass = false;
                }
                while (classDepths.length && braceDepth < classDepths[classDepths.length - 1]) {
                    classDepths.pop();
                }
                continue;
            }

            const processedLine = this.applyMemberPreview(line, options.maxMemberPreview, languageId);
            processed.push(processedLine);

            braceDepth = this.updateBraceDepth(line, braceDepth);
            if (pendingClass && line.includes('{')) {
                classDepths.push(preDepth + 1);
                pendingClass = false;
            }
            while (classDepths.length && braceDepth < classDepths[classDepths.length - 1]) {
                classDepths.pop();
            }
        }

        if (options.detailLevel === 'minimal') {
            const minimalPattern = /(class|interface|function|def|enum|struct|trait|module|namespace|constructor)/i;
            return processed
                .filter((line: string) => minimalPattern.test(line))
                .join("\n");
        }

        return processed.join("\n");
    }

    private buildFoldReplacement(
        languageId: string,
        summary: string | null,
        useCommentPlaceholder: boolean
    ): string {
        const placeholder = summary
            ? (languageId === 'python' ? `# ${summary}` : `/* ${summary} */`)
            : (useCommentPlaceholder && this.usesBlockComment(languageId) ? '/* ... */' : '...');

        if (languageId === 'python') {
            if (summary) {
                return ` ${placeholder}`;
            }
            return ' { ... }';
        }
        return ` { ${placeholder} }`;
    }

    private usesBlockComment(languageId: string): boolean {
        return languageId === 'typescript'
            || languageId === 'tsx'
            || languageId === 'javascript'
            || languageId === 'jsx';
    }

    private filterNestedFolds(folds: Array<{ start: number; end: number; replacement?: string }>) {
        const sorted = folds.slice().sort((a, b) => {
            if (a.start === b.start) return b.end - a.end;
            return a.start - b.start;
        });
        const result: Array<{ start: number; end: number; replacement?: string }> = [];
        for (const fold of sorted) {
            const last = result[result.length - 1];
            if (last && fold.start >= last.start && fold.end <= last.end) {
                continue;
            }
            result.push(fold);
        }
        return result;
    }

    private resolveFoldRange(node: any, content: string, languageId: string): { start: number; end: number } {
        let start = node.startIndex;
        let end = node.endIndex;
        if (languageId !== 'python') {
            const prevIndex = this.findPrevNonWhitespaceIndex(content, start);
            if (prevIndex !== null && content[prevIndex] === '{') {
                start = prevIndex;
                while (start > 0) {
                    const char = content[start - 1];
                    if (char === ' ' || char === '\t') {
                        start -= 1;
                        continue;
                    }
                    break;
                }
            }
            const nextIndex = this.findNextNonWhitespaceIndex(content, end);
            if (nextIndex !== null && content[nextIndex] === '}') {
                end = nextIndex + 1;
            }
        }
        return { start, end };
    }

    private findPrevNonWhitespaceIndex(content: string, index: number): number | null {
        for (let i = index - 1; i >= 0; i -= 1) {
            const char = content[i];
            if (!char || /\s/.test(char)) {
                continue;
            }
            return i;
        }
        return null;
    }

    private findNextNonWhitespaceIndex(content: string, index: number): number | null {
        for (let i = index; i < content.length; i += 1) {
            const char = content[i];
            if (!char || /\s/.test(char)) {
                continue;
            }
            return i;
        }
        return null;
    }

    private extractCallNames(slice: string): string[] {
        const regex = /([A-Za-z_][A-Za-z0-9_.$]*)\s*\(/g;
        const calls: string[] = [];
        const seen = new Set<string>();
        const stop = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'class', 'new']);
        let match;
        while ((match = regex.exec(slice)) !== null) {
            const name = match[1];
            if (stop.has(name)) {
                continue;
            }
            if (!seen.has(name)) {
                seen.add(name);
                calls.push(name);
            }
        }
        return calls;
    }

    private isClassDeclarationLine(trimmed: string, languageId: string): boolean {
        if (languageId === 'python') return false;
        return /\bclass\b/.test(trimmed) || /\binterface\b/.test(trimmed);
    }

    private isMemberVariableLine(trimmed: string, languageId: string): boolean {
        if (languageId === 'python') return false;
        if (trimmed.startsWith('}')) return false;
        if (/\b(get|set)\b/.test(trimmed)) return false;
        if (trimmed.includes('(')) return false;
        if (!trimmed.endsWith(';')) return false;
        return true;
    }

    private updateBraceDepth(line: string, depth: number): number {
        const openCount = (line.match(/{/g) || []).length;
        const closeCount = (line.match(/}/g) || []).length;
        return depth + openCount - closeCount;
    }

    private applyMemberPreview(line: string, maxMemberPreview: number, languageId: string): string {
        if (maxMemberPreview <= 0) return line;
        if (!this.usesBlockComment(languageId)) return line;
        if (!line.includes('[')) return line;
        return line.replace(/\[([^\]]+)\]/g, (match, inner) => {
            const parts = inner.split(',').map((part: string) => part.trim()).filter(Boolean);
            if (parts.length <= maxMemberPreview) return match;
            const preview = parts.slice(0, maxMemberPreview).join(', ');
            const remaining = parts.length - maxMemberPreview;
            return `[${preview}, ...${remaining} more]`;
        });
    }

    private isSkeletonPlaceholder(trimmed: string): boolean {
        return trimmed.startsWith('/*')
            && trimmed.includes('*/')
            && (trimmed.includes('...') || trimmed.includes('calls:'));
    }

    private isCommentText(trimmed: string, languageId: string): boolean {
        if (languageId === "markdown" || languageId === "md" || languageId === "mdx") {
            return /^<!--/.test(trimmed);
        }
        return /^(\*|#|\/\/|\/\*|<!--)/.test(trimmed);
    }
}
