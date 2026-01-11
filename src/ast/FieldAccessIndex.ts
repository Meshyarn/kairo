import { AstManager } from "./AstManager.js";
import { QueryProvider } from "./QueryProvider.js";
import { PropertyAccessIndex } from "./PropertyAccessIndex.js";
import { StructFieldAccessIndex } from "./StructFieldAccessIndex.js";
import { MemberSelectIndex } from "./MemberSelectIndex.js";
import { FieldExprIndex } from "./FieldExprIndex.js";
import { AttributeAccessIndex } from "./AttributeAccessIndex.js";
import type { FieldAccessIndexResult, FieldAccessLocation, FieldAccessLookup } from "./FieldAccessTypes.js";
import type { DegradedReason } from "../types/tool-responses.js";

type IndexOptions = {
    content?: string;
    packageName?: string;
    exportNames?: string[];
};

export class FieldAccessIndex {
    private readonly propertyAccessIndex: PropertyAccessIndex;
    private readonly goIndex: StructFieldAccessIndex;
    private readonly javaIndex: MemberSelectIndex;
    private readonly rustIndex: FieldExprIndex;
    private readonly pythonIndex: AttributeAccessIndex;
    private degradedByKey = new Map<string, DegradedReason[]>();

    constructor(
        private readonly rootPath: string,
        options?: {
            astManager?: AstManager;
            queryProvider?: QueryProvider;
            propertyAccessIndex?: PropertyAccessIndex;
        }
    ) {
        const astManager = options?.astManager ?? AstManager.getInstance();
        const queryProvider = options?.queryProvider ?? astManager.getQueryProvider();
        this.propertyAccessIndex = options?.propertyAccessIndex ?? new PropertyAccessIndex(rootPath);
        this.goIndex = new StructFieldAccessIndex(astManager, queryProvider);
        this.javaIndex = new MemberSelectIndex(astManager, queryProvider);
        this.rustIndex = new FieldExprIndex(astManager, queryProvider);
        this.pythonIndex = new AttributeAccessIndex(astManager, queryProvider);
    }

    public async indexFile(filePath: string, options?: IndexOptions): Promise<void> {
        const languageId = this.normalizeLanguageId(filePath);
        const packageName = options?.packageName ?? "unknown";
        const exportNames = options?.exportNames ?? [];

        if (languageId === "typescript") {
            this.propertyAccessIndex.indexFile(filePath, options);
            return;
        }

        const result = await this.indexByLanguage(languageId, filePath, options);
        if (result?.confidence === "low" && result.degradedReasons?.length) {
            for (const exportName of exportNames) {
                const key = this.serializeKey(packageName, exportName, "*");
                this.degradedByKey.set(key, result.degradedReasons);
            }
        }
    }

    public getUsages(packageName: string, exportName: string, fieldName: string): FieldAccessLookup {
        const usages: FieldAccessLocation[] = [
            ...this.propertyAccessIndex.getUsages(packageName, exportName, fieldName),
            ...this.goIndex.getUsages(packageName, exportName, fieldName),
            ...this.javaIndex.getUsages(packageName, exportName, fieldName),
            ...this.rustIndex.getUsages(packageName, exportName, fieldName),
            ...this.pythonIndex.getUsages(packageName, exportName, fieldName)
        ];

        const degradedReasons = this.lookupDegradedReasons(packageName, exportName, fieldName);
        const confidence = usages.length > 0 ? "high" : degradedReasons ? "low" : "high";

        return { usages, confidence, degradedReasons };
    }

    private async indexByLanguage(
        languageId: string,
        filePath: string,
        options?: IndexOptions
    ): Promise<FieldAccessIndexResult | undefined> {
        switch (languageId) {
            case "go":
                return this.goIndex.indexFile(filePath, options);
            case "java":
                return this.javaIndex.indexFile(filePath, options);
            case "rust":
                return this.rustIndex.indexFile(filePath, options);
            case "python":
                return this.pythonIndex.indexFile(filePath, options);
            default:
                return undefined;
        }
    }

    private normalizeLanguageId(filePath: string): string {
        const languageId = AstManager.getInstance().getLanguageId(filePath).toLowerCase();
        if (["typescript", "ts", "tsx", "javascript", "js", "jsx"].includes(languageId)) {
            return "typescript";
        }
        if (["python", "py"].includes(languageId)) {
            return "python";
        }
        if (["rust", "rs"].includes(languageId)) {
            return "rust";
        }
        return languageId;
    }

    private lookupDegradedReasons(
        packageName: string,
        exportName: string,
        fieldName: string
    ): DegradedReason[] | undefined {
        const directKey = this.serializeKey(packageName, exportName, fieldName);
        const wildcardKey = this.serializeKey(packageName, exportName, "*");
        return this.degradedByKey.get(directKey) ?? this.degradedByKey.get(wildcardKey);
    }

    private serializeKey(packageName: string, exportName: string, fieldName: string): string {
        return [packageName, exportName, fieldName].join("|");
    }
}
