import { AstManager } from "./AstManager.js";
import type { SkeletonOptions, SymbolInfo } from "../types.js";

export class SkeletonGenerator {
    private readonly astManager: AstManager;

    constructor(astManager?: AstManager) {
        this.astManager = astManager ?? AstManager.getInstance();
    }

    public async generateSkeleton(
        filePath: string,
        content: string,
        options?: SkeletonOptions
    ): Promise<string> {
        const resolvedOptions: SkeletonOptions = {
            useCommentPlaceholder: options?.useCommentPlaceholder ?? true,
            ...options
        };
        return this.astManager.generateUniversalSkeleton(filePath, content, resolvedOptions);
    }

    public async generateStructureJson(filePath: string, content: string): Promise<SymbolInfo[]> {
        return this.astManager.generateStructureJson(filePath, content);
    }

    public async findIdentifiers(filePath: string, content: string, targetNames: string[]): Promise<any[]> {
        return this.astManager.findIdentifiers(filePath, content, targetNames);
    }
}
