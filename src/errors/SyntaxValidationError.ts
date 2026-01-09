import type { ValidationDiagnostic } from "../types/validation.js";

export class SyntaxValidationError extends Error {
    public readonly diagnostics: ValidationDiagnostic[];

    constructor(message: string, diagnostics: ValidationDiagnostic[]) {
        super(message);
        this.name = "SyntaxValidationError";
        this.diagnostics = diagnostics;
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            diagnostics: this.diagnostics
        };
    }
}
