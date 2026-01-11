import fs from "fs";
import { AstManager } from "./AstManager.js";
import { QueryProvider } from "./QueryProvider.js";
import type { FieldAccessIndexKey, FieldAccessIndexResult, FieldAccessLocation } from "./FieldAccessTypes.js";
import type { DegradedReason } from "../types/tool-responses.js";

type IndexOptions = {
    content?: string;
    packageName?: string;
    exportNames?: string[];
};

export class StructFieldAccessIndex {
    private usages = new Map<string, FieldAccessLocation[]>();

    constructor(
        private readonly astManager: AstManager,
        private readonly queryProvider: QueryProvider
    ) {}

    public async indexFile(filePath: string, options?: IndexOptions): Promise<FieldAccessIndexResult> {
        const content = options?.content ?? fs.readFileSync(filePath, "utf-8");
        const languageId = this.astManager.getLanguageId(filePath);
        const exportNames = new Set(options?.exportNames ?? []);
        let doc;

        try {
            doc = await this.astManager.parseFile(filePath, content);
            const query = await this.queryProvider.getQuery(doc.rootNode.tree.language, languageId, "field_access");
            if (!query) {
                return {
                    confidence: "low",
                    degradedReasons: [this.buildMissingQueryReason(languageId)]
                };
            }

            const variableTypes = this.resolveVariableTypes(content, exportNames);
            const packageName = options?.packageName ?? "unknown";
            const matches = query.matches(doc.rootNode);

            for (const match of matches) {
                const baseNode = match.captures.find((capture) => capture.name === "field.base")?.node;
                const fieldNode = match.captures.find((capture) => capture.name === "field.name")?.node;
                if (!baseNode || !fieldNode) continue;
                const baseName = baseNode.text;
                const exportName = variableTypes.get(baseName);
                if (!exportName) continue;
                const fieldName = fieldNode.text;
                const loc = fieldNode.startPosition ?? { row: 0, column: 0 };
                this.recordUsage(
                    { packageName, exportName, fieldName },
                    {
                        filePath,
                        line: loc.row + 1,
                        column: loc.column + 1,
                        propertyChain: [fieldName]
                    }
                );
            }

            return { confidence: "high" };
        } catch {
            return {
                confidence: "low",
                degradedReasons: [this.buildUnsupportedLanguageReason(languageId)]
            };
        } finally {
            doc?.dispose?.();
        }
    }

    public getUsages(packageName: string, exportName: string, fieldName: string): FieldAccessLocation[] {
        const key = this.serializeKey({ packageName, exportName, fieldName });
        return this.usages.get(key) ?? [];
    }

    private resolveVariableTypes(content: string, exportNames: Set<string>): Map<string, string> {
        const result = new Map<string, string>();
        const varDecl = /\bvar\s+([A-Za-z_]\w*)\s+([A-Za-z_][\w.\[\]\*]*)/g;
        const shortDecl = /\b([A-Za-z_]\w*)\s*:=\s*&?\s*([A-Za-z_][\w.]*)\s*{/g;

        for (const match of content.matchAll(varDecl)) {
            const name = match[1];
            const typeName = this.normalizeTypeName(match[2]);
            if (exportNames.has(typeName)) {
                result.set(name, typeName);
            }
        }

        for (const match of content.matchAll(shortDecl)) {
            const name = match[1];
            const typeName = this.normalizeTypeName(match[2]);
            if (exportNames.has(typeName)) {
                result.set(name, typeName);
            }
        }

        return result;
    }

    private normalizeTypeName(typeName: string): string {
        const trimmed = typeName.trim();
        const withoutPointers = trimmed.replace(/^[\[\]\*]+/u, "");
        const withoutModules = withoutPointers.split(".").pop() ?? withoutPointers;
        return withoutModules.trim();
    }

    private recordUsage(key: FieldAccessIndexKey, location: FieldAccessLocation): void {
        const serialized = this.serializeKey(key);
        const existing = this.usages.get(serialized) ?? [];
        existing.push(location);
        this.usages.set(serialized, existing);
    }

    private serializeKey(key: FieldAccessIndexKey): string {
        return [key.packageName, key.exportName, key.fieldName].join("|");
    }

    private buildMissingQueryReason(languageId: string): DegradedReason {
        return {
            type: "missing_query_pack",
            languageId,
            message: `Missing field access query pack for ${languageId}.`,
            action: "add_query_pack"
        };
    }

    private buildUnsupportedLanguageReason(languageId: string): DegradedReason {
        return {
            type: "unsupported_language",
            languageId,
            message: `Failed to parse ${languageId} file for field access.`
        };
    }
}
