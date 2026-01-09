import { AstManager } from "../AstManager.js";
import type { SymbolInfo } from "../../types.js";

export class SymbolExtractor {
    public async generateStructureJson(
        filePath: string,
        content: string,
        astManager?: AstManager
    ): Promise<SymbolInfo[]> {
        const manager = astManager ?? AstManager.getInstance();
        return manager.generateStructureJson(filePath, content);
    }
}
