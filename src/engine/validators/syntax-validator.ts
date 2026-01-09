import { AstManager } from "../../ast/AstManager.js";
import type { ValidationDiagnostic, ValidationResult } from "../../types/validation.js";

const MAX_SNIPPET_LENGTH = 80;

export class SyntaxValidator {
    private readonly astManager: AstManager;

    constructor(astManager?: AstManager) {
        this.astManager = astManager ?? AstManager.getInstance();
    }

    async validate(filePath: string, content: string): Promise<ValidationResult> {
        const startTime = performance.now();
        let doc: any;
        try {
            doc = await this.astManager.parseFile(filePath, content);
            const rootNode = doc?.rootNode;
            if (!this.supportsTreeSitter(rootNode)) {
                return { success: true, durationMs: performance.now() - startTime };
            }

            const errors = this.detectErrorNodes(rootNode, content, filePath);
            const durationMs = performance.now() - startTime;
            if (errors.length > 0) {
                return { success: false, blockingErrors: errors, durationMs };
            }

            return { success: true, durationMs };
        } catch (error: any) {
            const durationMs = performance.now() - startTime;
            const message = typeof error?.message === "string" ? error.message : "Unknown parse error";
            if (this.shouldSkipError(message)) {
                return { success: true, durationMs };
            }
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
        } finally {
            doc?.dispose?.();
        }
    }

    private supportsTreeSitter(node: any): boolean {
        return Boolean(
            node &&
            typeof node.type === "string" &&
            node.startPosition &&
            node.endPosition
        );
    }

    private shouldSkipError(message: string): boolean {
        const normalized = message.toLowerCase();
        return normalized.includes("unsupported language")
            || normalized.includes("failed to load language")
            || normalized.includes("failed to initialize ast backend")
            || normalized.includes("snapshot not found");
    }

    private detectErrorNodes(node: any, content: string, filePath: string): ValidationDiagnostic[] {
        const hasError = typeof node?.hasError === "function"
            ? node.hasError()
            : Boolean(node?.hasError);
        if (!hasError) {
            return [];
        }

        const errors: ValidationDiagnostic[] = [];
        const stack: any[] = [node];

        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) continue;

            if (this.isErrorNode(current)) {
                errors.push(this.buildDiagnostic(current, content, filePath));
            }

            const children = this.getChildren(current);
            for (let i = children.length - 1; i >= 0; i -= 1) {
                stack.push(children[i]);
            }
        }

        return errors;
    }

    private isErrorNode(node: any): boolean {
        const type = typeof node?.type === "string" ? node.type : "";
        const isError = typeof node?.isError === "function"
            ? node.isError()
            : Boolean(node?.isError);
        const isMissing = typeof node?.isMissing === "function"
            ? node.isMissing()
            : Boolean(node?.isMissing);
        return type === "ERROR" || isError || isMissing;
    }

    private getChildren(node: any): any[] {
        if (Array.isArray(node?.children)) {
            return node.children;
        }
        if (Array.isArray(node?.namedChildren)) {
            return node.namedChildren;
        }
        if (typeof node?.childCount === "number" && typeof node?.child === "function") {
            const children: any[] = [];
            for (let i = 0; i < node.childCount; i += 1) {
                children.push(node.child(i));
            }
            return children;
        }
        return [];
    }

    private buildDiagnostic(node: any, content: string, filePath: string): ValidationDiagnostic {
        const startPosition = node?.startPosition ?? { row: 0, column: 0 };
        const startIndex = typeof node?.startIndex === "number" ? node.startIndex : 0;
        const endIndex = typeof node?.endIndex === "number" ? node.endIndex : startIndex;
        const snippet = content.slice(startIndex, Math.min(endIndex, startIndex + MAX_SNIPPET_LENGTH));

        return {
            filePath,
            line: startPosition.row + 1,
            column: startPosition.column + 1,
            message: "Syntax error detected.",
            code: "SYNTAX_ERROR",
            provider: "syntax",
            severity: "error",
            snippet: snippet.trim()
        };
    }
}