import { createRequire } from "module";

export type RustSyntaxIssue = {
    line: number;
    column: number;
    message: string;
};

type RustSyntaxModule = {
    validateSyntax: (language: string, content: string) => RustSyntaxIssue[];
};

const require = createRequire(import.meta.url);

export class RustSyntaxValidator {
    private static instance: RustSyntaxValidator | null = null;
    private static warned = false;
    private module: RustSyntaxModule | null = null;

    private constructor() {
        try {
            this.module = require("@kairo/core-rs") as RustSyntaxModule;
        } catch (error: any) {
            this.warnOnce(`Rust syntax validator unavailable (${error?.message ?? "unknown error"}); falling back to Tree-sitter.`);
            this.module = null;
        }
    }

    static getShared(): RustSyntaxValidator {
        if (!this.instance) {
            this.instance = new RustSyntaxValidator();
        }
        return this.instance;
    }

    isAvailable(): boolean {
        return this.module !== null;
    }

    validate(language: string, content: string): RustSyntaxIssue[] {
        if (!this.module) return [];
        return this.module.validateSyntax(language, content);
    }

    private warnOnce(message: string): void {
        if (RustSyntaxValidator.warned) return;
        RustSyntaxValidator.warned = true;
        console.warn(`[RustSyntaxValidator] ${message}`);
    }
}
