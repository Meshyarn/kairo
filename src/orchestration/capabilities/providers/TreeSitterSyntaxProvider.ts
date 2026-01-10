import { AstManager } from "../../../ast/AstManager.js";
import type { CapabilityProvider } from "../EngineManager.js";
import type { ISyntaxValidationProvider, SyntaxIssue } from "../SyntaxValidation.js";

const ERROR_MESSAGE = "Syntax error detected.";

export class TreeSitterSyntaxProvider implements CapabilityProvider<ISyntaxValidationProvider> {
    meta = { id: "TreeSitterSyntaxProvider", tier: "wasm" as const, priority: 50 };
    private readonly astManager = AstManager.getInstance();

    isAvailable(): boolean {
        return true;
    }

    get(): ISyntaxValidationProvider {
        return {
            validate: async (filePath: string, content: string): Promise<SyntaxIssue[]> =>
                this.validateSyntax(filePath, content)
        };
    }

    private async validateSyntax(filePath: string, content: string): Promise<SyntaxIssue[]> {
        let doc: any;
        try {
            doc = await this.astManager.parseFile(filePath, content);
            const rootNode = doc?.rootNode;
            if (!this.supportsTreeSitter(rootNode)) {
                return [];
            }
            return this.detectErrorNodes(rootNode);
        } catch (error: any) {
            const message = typeof error?.message === "string" ? error.message : "Unknown parse error";
            if (this.shouldSkipError(message)) {
                return [];
            }
            return [{ line: 1, column: 1, message: `Parse error: ${message}` }];
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

    private detectErrorNodes(node: any): SyntaxIssue[] {
        const hasError = typeof node?.hasError === "function"
            ? node.hasError()
            : Boolean(node?.hasError);
        if (!hasError) {
            return [];
        }

        const errors: SyntaxIssue[] = [];
        const stack: any[] = [node];

        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) continue;

            if (this.isErrorNode(current)) {
                const startPosition = current?.startPosition ?? { row: 0, column: 0 };
                errors.push({
                    line: startPosition.row + 1,
                    column: startPosition.column + 1,
                    message: ERROR_MESSAGE
                });
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
}
