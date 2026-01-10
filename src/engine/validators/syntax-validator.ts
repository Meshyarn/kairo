import { EngineManager } from "../../orchestration/capabilities/EngineManager.js";
import { CAP_SYNTAX_VALIDATE } from "../../orchestration/capabilities/CapabilityIds.js";
import type { ISyntaxValidationProvider } from "../../orchestration/capabilities/SyntaxValidation.js";
import type { ValidationResult } from "../../types/validation.js";

export class SyntaxValidator {
    constructor() {}

    async validate(filePath: string, content: string): Promise<ValidationResult> {
        const startTime = performance.now();
        try {
            const provider = EngineManager.getProvider<ISyntaxValidationProvider>(CAP_SYNTAX_VALIDATE);
            if (!provider) {
                return { success: true, durationMs: performance.now() - startTime };
            }
            const issues = await provider.validate(filePath, content);
            const durationMs = performance.now() - startTime;
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
                    durationMs
                };
            }
            return { success: true, durationMs };
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
                durationMs
            };
        }
    }
}
