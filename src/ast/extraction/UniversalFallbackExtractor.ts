import type { ImportSymbol } from "../../types.js";

type ImportParts = { name: string; alias?: string };

export class UniversalFallbackExtractor {
    public extractImports(content: string, languageId: string): ImportSymbol[] {
        if (!content) return [];
        switch (languageId) {
            case "python":
                return this.extractPythonImports(content);
            case "go":
                return this.extractGoImports(content);
            case "rust":
                return this.extractRustImports(content);
            default:
                return [];
        }
    }

    private extractPythonImports(content: string): ImportSymbol[] {
        const results: ImportSymbol[] = [];
        const importPattern = /^\s*import\s+([^\n#]+)$/gm;
        const fromPattern = /^\s*from\s+([\w.]+)\s+import\s+([^\n#]+)$/gm;

        for (const match of content.matchAll(importPattern)) {
            const imports = match[1].split(",").map(part => part.trim()).filter(Boolean);
            for (const item of imports) {
                const parsed = this.parseAlias(item);
                results.push(this.buildImportSymbol(match.index ?? 0, match[0].length, content, {
                    source: parsed.name,
                    name: parsed.name,
                    importKind: "named",
                    imports: [{ name: parsed.name, alias: parsed.alias }],
                    alias: parsed.alias
                }));
            }
        }

        for (const match of content.matchAll(fromPattern)) {
            const source = match[1];
            const list = match[2].replace(/[()]/g, "").trim();
            if (list === "*") {
                results.push(this.buildImportSymbol(match.index ?? 0, match[0].length, content, {
                    source,
                    name: "*",
                    importKind: "namespace",
                    imports: []
                }));
                continue;
            }
            const imports: ImportParts[] = list.split(",").map(part => this.parseAlias(part.trim())).filter(part => part.name);
            if (imports.length === 0) continue;
            results.push(this.buildImportSymbol(match.index ?? 0, match[0].length, content, {
                source,
                name: imports[0].name,
                importKind: "named",
                imports
            }));
        }

        return results;
    }

    private extractGoImports(content: string): ImportSymbol[] {
        const results: ImportSymbol[] = [];
        const singlePattern = /^\s*import\s+(?:([.\w]+)\s+)?"([^"]+)"\s*$/gm;
        const blockPattern = /^\s*import\s*\(([\s\S]*?)\)\s*$/gm;

        for (const match of content.matchAll(singlePattern)) {
            const source = match[2];
            const name = this.basename(source);
            results.push(this.buildImportSymbol(match.index ?? 0, match[0].length, content, {
                source,
                name,
                importKind: "named",
                imports: [{ name }],
                alias: match[1]
            }));
        }

        for (const match of content.matchAll(blockPattern)) {
            const block = match[1];
            const lines = block.split(/\r?\n/);
            let offset = (match.index ?? 0) + match[0].indexOf(block);
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) {
                    offset += line.length + 1;
                    continue;
                }
                const lineMatch = trimmed.match(/^(?:([.\w]+)\s+)?"([^"]+)"/);
                if (!lineMatch) {
                    offset += line.length + 1;
                    continue;
                }
                const source = lineMatch[2];
                const name = this.basename(source);
                results.push(this.buildImportSymbol(offset, trimmed.length, content, {
                    source,
                    name,
                    importKind: "named",
                    imports: [{ name }],
                    alias: lineMatch[1]
                }));
                offset += line.length + 1;
            }
        }

        return results;
    }

    private extractRustImports(content: string): ImportSymbol[] {
        const results: ImportSymbol[] = [];
        const usePattern = /^\s*use\s+([^;]+);/gm;

        for (const match of content.matchAll(usePattern)) {
            const raw = match[1].trim();
            if (!raw) continue;
            const { source, imports, name } = this.parseRustUse(raw);
            results.push(this.buildImportSymbol(match.index ?? 0, match[0].length, content, {
                source,
                name,
                importKind: "named",
                imports
            }));
        }

        return results;
    }

    private parseAlias(text: string): ImportParts {
        const parts = text.split(/\s+as\s+/i).map(part => part.trim()).filter(Boolean);
        if (parts.length === 0) return { name: "" };
        if (parts.length === 1) return { name: parts[0] };
        return { name: parts[0], alias: parts[1] };
    }

    private parseRustUse(raw: string): { source: string; imports: ImportParts[]; name: string } {
        if (raw.includes("{")) {
            const [prefix, rest] = raw.split("{", 2);
            const source = prefix.replace(/::\s*$/, "").trim();
            const inner = rest.replace(/}\s*$/, "");
            const imports = inner.split(",").map(part => this.parseAlias(part.trim())).filter(part => part.name);
            const name = imports[0]?.name ?? source.split("::").pop() ?? source;
            return { source, imports, name };
        }
        const parts = raw.split("::").map(part => part.trim()).filter(Boolean);
        const name = parts[parts.length - 1] ?? raw;
        const source = parts.slice(0, -1).join("::") || raw;
        return { source, imports: [{ name }], name };
    }

    private basename(value: string): string {
        const segments = value.split("/");
        return segments[segments.length - 1] || value;
    }

    private buildImportSymbol(
        startIndex: number,
        length: number,
        content: string,
        details: {
            source: string;
            name: string;
            importKind: "named" | "namespace" | "default" | "side-effect";
            imports: ImportParts[];
            alias?: string;
        }
    ): ImportSymbol {
        const endIndex = startIndex + length;
        const { startLine, endLine } = this.computeLineRange(content, startIndex, endIndex);
        return {
            type: "import",
            name: details.name,
            source: details.source,
            importKind: details.importKind,
            alias: details.alias,
            imports: details.imports,
            range: {
                startLine,
                endLine,
                startByte: startIndex,
                endByte: endIndex
            }
        };
    }

    private computeLineRange(content: string, startIndex: number, endIndex: number): { startLine: number; endLine: number } {
        const before = content.slice(0, Math.max(0, startIndex));
        const segment = content.slice(Math.max(0, startIndex), Math.max(0, endIndex));
        const startLine = before.split(/\r?\n/).length;
        const endLine = startLine + Math.max(0, segment.split(/\r?\n/).length - 1);
        return { startLine, endLine };
    }
}
