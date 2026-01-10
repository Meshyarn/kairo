import { EngineManager } from "../../orchestration/capabilities/EngineManager.js";
import { CAP_SYNTAX_VALIDATE } from "../../orchestration/capabilities/CapabilityIds.js";
import type { ISyntaxValidationProvider } from "../../orchestration/capabilities/SyntaxValidation.js";
import type { ValidationResult } from "../../types/validation.js";
import { AstManager } from "../../ast/AstManager.js";
import { getSupportForFilePath, SupportLevel } from "../../config/LanguageSupportLevels.js";

export class SyntaxValidator {
    constructor() {}

    async validate(filePath: string, content: string): Promise<ValidationResult> {
        const startTime = performance.now();
        const astManager = AstManager.getInstance();
        const support = getSupportForFilePath(filePath);
        const languageId = astManager.getLanguageId(filePath);
        try {
            const provider = EngineManager.getProvider<ISyntaxValidationProvider>(CAP_SYNTAX_VALIDATE);
            if (!provider) {
                return {
                    success: true,
                    durationMs: performance.now() - startTime,
                    languageId,
                    supportLevel: support?.level
                };
            }
            const issues = await provider.validate(filePath, content);
            const durationMs = performance.now() - startTime;
            if (support?.level === SupportLevel.L3 && support.editPolicy.requireSyntaxValidation) {
                const languageAvailable = await this.isLanguageAvailable(astManager, filePath);
                if (!languageAvailable) {
                    return {
                        success: false,
                        blockingErrors: [{
                            filePath,
                            message: "Syntax validation unavailable for this language.",
                            code: "SYNTAX_LANGUAGE_UNAVAILABLE",
                            provider: "syntax",
                            severity: "error"
                        }],
                        durationMs,
                        languageId,
                        supportLevel: support.level
                    };
                }
            }
            if (issues.length > 0) {
                return {
                    success: false,
                    blockingErrors: issues.map((issue) => ({
                        filePath,
                        line: issue.line,
                        column: issue.column,
                        message: issue.message,
                        code: "SYNTAX_ERROR",
                        provider: "syntax",
                        severity: "error"
                    })),
                    durationMs,
                    languageId,
                    supportLevel: support?.level
                };
            }
            return {
                success: true,
                durationMs,
                languageId,
                supportLevel: support?.level
            };
        } catch (error: any) {
            const durationMs = performance.now() - startTime;
            const message = typeof error?.message === "string" ? error.message : "Unknown parse error";
            return {
                success: false,
                blockingErrors: [{
                    filePath,
                    message: `Parse error: ${message}`,
                    provider: "syntax",
                    severity: "error"
                }],
                durationMs,
                languageId,
                supportLevel: support?.level
            };
        }
    }

    private async isLanguageAvailable(astManager: AstManager, filePath: string): Promise<boolean> {
        try {
            const language = await astManager.getLanguageForFile(filePath);
            return Boolean(language);
        } catch {
            return false;
        }
    }
}
