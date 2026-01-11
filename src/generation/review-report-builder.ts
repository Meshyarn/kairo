import { SyntaxValidator } from "../engine/validators/syntax-validator.js";
import { evaluateIntegrityGuardrails, normalizeGuardrailContent, resolveGuardrailTargetPath } from "../orchestration/guardrails/IntegrityGuardrails.js";
import type { DependencyGraph } from "../ast/DependencyGraph.js";
import type { IndexStateManager } from "../indexing/IndexStateManager.js";
import type {
    GuardrailsValidation,
    ReviewReport,
    SuggestedAction,
    SyntaxValidation,
    VibeAlignmentValidation,
    Verdict
} from "../types/flow-artifacts.js";
import { scoreVibeAlignment } from "./vibe-alignment-scorer.js";
import type { StylePack } from "../types/flow-artifacts.js";

export interface ReviewReportBuilderOptions {
    strictness?: "strict" | "balanced" | "permissive";
    enableSyntax?: boolean;
    enableVibe?: boolean;
    enableGuardrails?: boolean;
}

export class ReviewReportBuilder {
    private readonly syntaxValidator = new SyntaxValidator();

    constructor(
        private readonly args: {
            dependencyGraph?: DependencyGraph;
            indexStateManager?: IndexStateManager;
        },
        private readonly options: ReviewReportBuilderOptions = {}
    ) {}

    async review(input: {
        filePath: string;
        content: string;
        oldContent?: string;
        guardrailResult?: any;
        constraints?: any;
        stylePack?: StylePack;
    }): Promise<ReviewReport> {
        const syntax = this.options.enableSyntax === false
            ? undefined
            : await this.validateSyntax(input.filePath, input.content);

        const guardrails = this.options.enableGuardrails === false
            ? undefined
            : await this.validateGuardrails(input);

        const vibeAlignment = this.options.enableVibe === false
            ? undefined
            : this.validateVibeAlignment(input);

        const verdict = this.computeVerdict([syntax, guardrails, vibeAlignment].filter(Boolean) as Array<{ verdict: Verdict }>);

        return {
            id: this.generateReportId(),
            verdict,
            syntax,
            guardrails,
            vibeAlignment,
            suggestedActions: this.suggestActions(verdict),
            reviewedAt: Date.now(),
            reviewedFiles: [input.filePath]
        };
    }

    private async validateSyntax(filePath: string, content: string): Promise<SyntaxValidation> {
        const result = await this.syntaxValidator.validate(filePath, content);
        if (result.success) {
            return { verdict: "pass", diagnostics: [], summary: "Syntax validation passed." };
        }
        const diagnostics = (result.blockingErrors ?? []).map((diag) => ({
            file: diag.filePath,
            line: diag.line ?? 0,
            column: diag.column ?? 0,
            message: diag.message,
            severity: (diag.severity === "warning" ? "warning" : "error") as "warning" | "error",
            rule: diag.code
        }));
        return {
            verdict: "block",
            diagnostics,
            summary: "Syntax validation failed."
        };
    }

    private async validateGuardrails(input: {
        filePath: string;
        content: string;
        oldContent?: string;
        guardrailResult?: any;
        constraints?: any;
    }): Promise<GuardrailsValidation> {
        const guardrailResult = input.guardrailResult ?? await evaluateIntegrityGuardrails({
            targetPath: resolveGuardrailTargetPath(input.filePath),
            oldContent: normalizeGuardrailContent(input.oldContent ?? ""),
            newContent: normalizeGuardrailContent(input.content),
            dependencyGraph: this.args.dependencyGraph,
            indexStateManager: this.args.indexStateManager,
            constraints: input.constraints,
            runTool: () => Promise.resolve(undefined),
            applyMode: false
        });

        const blockingErrors = Array.isArray(guardrailResult?.blockingErrors)
            ? guardrailResult.blockingErrors.map((item: any) => String(item?.message ?? item))
            : [];
        const warnings = Array.isArray(guardrailResult?.warnings)
            ? guardrailResult.warnings.map((item: any) => String(item?.message ?? item))
            : [];
        const verdict: Verdict = guardrailResult?.status === "block"
            ? "block"
            : (warnings.length > 0 ? "warn" : "pass");

        return {
            verdict,
            checks: {},
            blockingErrors,
            warnings,
            summary: guardrailResult?.status === "block"
                ? "Guardrails blocked the change."
                : "Guardrails check completed."
        };
    }

    private validateVibeAlignment(input: {
        filePath: string;
        content: string;
        stylePack?: StylePack;
    }): VibeAlignmentValidation {
        return scoreVibeAlignment({
            filePath: input.filePath,
            content: input.content,
            stylePack: input.stylePack,
            strictness: this.options.strictness
        });
    }

    private computeVerdict(validations: Array<{ verdict: Verdict }>): Verdict {
        if (validations.some((validation) => validation.verdict === "block")) {
            return "block";
        }
        if (validations.some((validation) => validation.verdict === "warn")) {
            return "warn";
        }
        return "pass";
    }

    private suggestActions(verdict: Verdict): SuggestedAction[] {
        if (verdict === "pass") {
            return [];
        }
        return [{
            pillar: "change",
            action: "review",
            args: {},
            priority: "high",
            reason: "Review findings before applying changes."
        }];
    }

    private generateReportId(): string {
        const suffix = Math.random().toString(36).slice(2, 8);
        return `review_${Date.now().toString(36)}_${suffix}`;
    }
}
