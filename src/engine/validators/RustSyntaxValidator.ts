import { EngineManager } from "../../orchestration/capabilities/EngineManager.js";
import { CAP_SYNTAX_VALIDATE } from "../../orchestration/capabilities/CapabilityIds.js";
import type { ISyntaxValidationProvider } from "../../orchestration/capabilities/SyntaxValidation.js";
import type { SyntaxIssue } from "../../orchestration/capabilities/SyntaxValidation.js";

export class RustSyntaxValidator {
    private static instance: RustSyntaxValidator | null = null;
    private provider: ISyntaxValidationProvider | null = null;

    private constructor() {
        this.provider = EngineManager.getProvider<ISyntaxValidationProvider>(CAP_SYNTAX_VALIDATE);
    }

    static getShared(): RustSyntaxValidator {
        if (!this.instance) {
            this.instance = new RustSyntaxValidator();
        }
        return this.instance;
    }

    isAvailable(): boolean {
        return this.resolveProvider() !== null;
    }

    validate(filePath: string, content: string): SyntaxIssue[] {
        const provider = this.resolveProvider();
        if (!provider) return [];
        return provider.validate(filePath, content);
    }

    private resolveProvider(): ISyntaxValidationProvider | null {
        if (!this.provider) {
            this.provider = EngineManager.getProvider<ISyntaxValidationProvider>(CAP_SYNTAX_VALIDATE);
        }
        return this.provider;
    }
}
