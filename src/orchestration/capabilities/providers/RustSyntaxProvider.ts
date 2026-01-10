import path from "path";
import { NativeModuleLoader } from "../NativeModuleLoader.js";
import type { CapabilityProvider } from "../EngineManager.js";
import type { ISyntaxValidationProvider, SyntaxIssue } from "../SyntaxValidation.js";

export class RustSyntaxProvider implements CapabilityProvider<ISyntaxValidationProvider> {
    meta = { id: "RustSyntaxProvider", tier: "native" as const, priority: 100 };
    private provider: ISyntaxValidationProvider | null = null;

    constructor() {
        const core = NativeModuleLoader.getShared().getRustCore();
        if (!core) return;
        this.provider = {
            validate: (filePath: string, content: string): SyntaxIssue[] => {
                const language = resolveLanguageId(filePath);
                if (!language) return [];
                return core.validateSyntax(language, content);
            }
        };
    }

    isAvailable(): boolean {
        return this.provider !== null;
    }

    get(): ISyntaxValidationProvider {
        return this.provider as ISyntaxValidationProvider;
    }
}

function resolveLanguageId(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case ".ts":
            return "ts";
        case ".tsx":
            return "tsx";
        case ".js":
        case ".mjs":
        case ".cjs":
            return "js";
        case ".jsx":
            return "jsx";
        default:
            return null;
    }
}
