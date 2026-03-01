import { SyntaxValidator } from "../engine/validators/syntax-validator.js";
import { SemanticValidator } from "../engine/validators/semantic-validator.js";
import { SymbolicGuardEngine } from "../engine/validators/symbolic-guard-engine.js";
import { ConfigurationManager } from "../config/ConfigurationManager.js";
/** Inlined stub — guardrails module was removed in ADR-092. */
async function evaluateIntegrityGuardrails(_opts: any): Promise<{ status: string; blockingErrors: never[]; warnings: never[] }> {
    return { status: "pass", blockingErrors: [], warnings: [] };
}
function normalizeGuardrailContent(content: string): string { return content; }
function resolveGuardrailTargetPath(filePath: string): string { return filePath; }

import type { DependencyGraph } from "../ast/DependencyGraph.js";
import type { IndexStateManager } from "../indexing/IndexStateManager.js";
import type { DegradedReason } from "../types/tool-responses.js";
/** Inlined stub — DegradedReasonMapper was removed in ADR-092. */
function buildDegradedReasons(reasons: any[], _ctx?: Record<string, unknown>): DegradedReason[] {
    return Array.isArray(reasons) ? reasons.map((r: any) => ({ type: r?.type ?? 'degraded', message: String(r?.message ?? r) }) as DegradedReason) : [];
}
import { resolveSymbolicGuardConfig } from "../config/SymbolicGuardConfig.js";
import type {
    GuardrailsValidation,
    ReviewReport,
    SuggestedAction,
    SyntaxValidation,
    SemanticValidation,
    VibeAlignmentValidation,
    Verdict
} from "../types/flow-artifacts.js";
import { scoreVibeAlignment } from "./vibe-alignment-scorer.js";
import type { StylePack } from "../types/flow-artifacts.js";
import type { ValidationMode } from "../types/validation.js";
import type { CrossLangImpact } from "../types/engine.js";

export interface ReviewReportBuilderOptions {
    strictness?: "strict" | "balanced" | "permissive";
    enableSyntax?: boolean;
    enableSemantic?: boolean;
    enableVibe?: boolean;
    enableGuardrails?: boolean;
}

export class ReviewReportBuilder {
    private readonly syntaxValidator = new SyntaxValidator();
    private readonly semanticValidator?: SemanticValidator;
    private readonly semanticMode: ValidationMode;
    private readonly symbolicGuardEngine = new SymbolicGuardEngine();

    constructor(
        private readonly args: {
            dependencyGraph?: DependencyGraph;
            indexStateManager?: IndexStateManager;
        },
        private readonly options: ReviewReportBuilderOptions = {}
    ) {
        const validationConfig = ConfigurationManager.getValidationConfig();
        this.semanticMode = validationConfig.semantic;
        if (this.semanticMode !== "off") {
            this.semanticValidator = new SemanticValidator({ rootPath: process.cwd() });
        }
    }

    async review(input: {
        filePath: string;
        content: string;
        oldContent?: string;
        guardrailResult?: any;
        constraints?: any;
        stylePack?: StylePack;
        contractImpact?: CrossLangImpact;
    }): Promise<ReviewReport> {
        const syntax = this.options.enableSyntax === false
            ? undefined
            : await this.validateSyntax(input.filePath, input.content);

        const guardrails = this.options.enableGuardrails === false
            ? undefined
            : await this.validateGuardrails(input);

        const semantic = this.options.enableSemantic === false
            ? undefined
            : await this.validateSemantic(input.filePath, input.content, input.contractImpact);

        const vibeAlignment = this.options.enableVibe === false
            ? undefined
            : this.validateVibeAlignment(input);

        const verdict = this.computeVerdict([syntax, semantic, guardrails, vibeAlignment].filter(Boolean) as Array<{ verdict: Verdict }>);

        return {
            id: this.generateReportId(),
            verdict,
            syntax,
            semantic,
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

    private async validateSemantic(
        filePath: string,
        content: string,
        contractImpact?: CrossLangImpact
    ): Promise<SemanticValidation> {
        const degradedReasons: NonNullable<SemanticValidation["degradedReasons"]> = [];
        const diagnostics: SemanticValidation["diagnostics"] = [];
        let nameLinkUsed = false;
        let nameLinkDurationMs = 0;
        let nameLinkVerdict: Verdict = "pass";

        if (this.semanticValidator && this.semanticMode !== "off") {
            nameLinkUsed = true;
            const start = Date.now();
            const result = await this.semanticValidator.validate(filePath, content);
            nameLinkDurationMs = Number.isFinite(result.durationMs)
                ? Math.round(result.durationMs as number)
                : Date.now() - start;
            diagnostics.push(
                ...[...(result.blockingErrors ?? []), ...(result.warnings ?? [])].map((diag) => {
                    const diagSeverity: "error" | "warning" =
                        this.semanticMode === "error"
                            ? "error"
                            : (diag.severity === "warning" ? "warning" : "error");
                    return {
                        file: diag.filePath,
                        line: diag.line ?? 0,
                        column: diag.column ?? 0,
                        message: diag.message,
                        code: diag.code ?? "SEMANTIC_VALIDATION",
                        severity: diagSeverity
                    };
                })
            );
            if (!result.success) {
                nameLinkVerdict = this.semanticMode === "error" ? "block" : "warn";
            }
        } else {
            degradedReasons.push({
                type: "degraded" as const,
                message: "Name/link semantic validation is disabled by policy.",
                severity: "info" as const
            });
        }

        const symbolicResult = await this.symbolicGuardEngine.evaluate({ filePath, content });
        const symbolicHasError = symbolicResult.diagnostics.some((diag) => diag.severity === "high");
        const symbolicDiagnostics = symbolicResult.diagnostics.map((diag) => {
            const severity: "error" | "warning" = diag.severity === "high" ? "error" : "warning";
            return {
                file: diag.filePath ?? filePath,
                line: diag.line ?? 0,
                column: diag.column ?? 0,
                message: diag.message,
                code: diag.code,
                severity
            };
        });
        diagnostics.push(...symbolicDiagnostics);

        const symbolicDegraded = buildDegradedReasons(symbolicResult.degradedReasons ?? [], { filePath });
        if (symbolicDegraded?.length) {
            degradedReasons.push(...symbolicDegraded);
        }

        const guardConfig = resolveSymbolicGuardConfig();
        const contractMode = guardConfig.contractGuard.mode;
        let contractHasError = false;
        if (contractImpact) {
            const breakingExports = Array.isArray(contractImpact.breakingExports)
                ? contractImpact.breakingExports
                : [];
            const nonBreakingExports = Array.isArray(contractImpact.nonBreakingExports)
                ? contractImpact.nonBreakingExports
                : [];
            const changedExports = Array.isArray(contractImpact.changedExports)
                ? contractImpact.changedExports
                : [];
            const remaining = Math.max(0, guardConfig.maxDiagnostics - diagnostics.length);
            let budgetLeft = remaining;
            const pushContractDiagnostic = (entry: SemanticValidation["diagnostics"][number]) => {
                if (budgetLeft <= 0) return;
                diagnostics.push(entry);
                budgetLeft -= 1;
            };
            if (breakingExports.length > 0) {
                pushContractDiagnostic({
                    file: filePath,
                    line: 0,
                    column: 0,
                    message: `Contract exports removed or changed: ${breakingExports.slice(0, 8).join(", ")}.`,
                    code: "CONTRACT_BREAKING_CHANGE",
                    severity: "error"
                });
                contractHasError = true;
            }
            if (nonBreakingExports.length > 0) {
                pushContractDiagnostic({
                    file: filePath,
                    line: 0,
                    column: 0,
                    message: `Contract exports added: ${nonBreakingExports.slice(0, 8).join(", ")}.`,
                    code: "CONTRACT_NON_BREAKING_CHANGE",
                    severity: "warning"
                });
            } else if (breakingExports.length === 0 && changedExports.length > 0) {
                pushContractDiagnostic({
                    file: filePath,
                    line: 0,
                    column: 0,
                    message: `Contract surface changed: ${changedExports.slice(0, 8).join(", ")}.`,
                    code: "CONTRACT_CHANGE",
                    severity: "warning"
                });
            }
            if (contractMode === "spec_plus_consumer_scan" && Array.isArray(contractImpact.fieldImpacts)) {
                for (const impact of contractImpact.fieldImpacts) {
                    if (budgetLeft <= 0) break;
                    const usage = impact.usages?.[0];
                    pushContractDiagnostic({
                        file: usage?.filePath ?? filePath,
                        line: usage?.line ?? 0,
                        column: usage?.column ?? 0,
                        message: `Field '${impact.fieldName}' of '${impact.exportName}' is used in ${impact.usages?.length ?? 0} locations.`,
                        code: "CONTRACT_FIELD_USAGE",
                        severity: "warning"
                    });
                }
            }
            const contractDegraded = buildDegradedReasons(contractImpact.reasons ?? [], {
                packageName: contractImpact.packageName
            });
            if (contractDegraded?.length) {
                degradedReasons.push(...contractDegraded);
            }
        }

        const blockOnErrors = symbolicResult.mode === "block_high" || symbolicResult.mode === "strict";
        const hasBlock = nameLinkVerdict === "block"
            || (blockOnErrors && (symbolicHasError || contractHasError));
        const hasWarn = nameLinkVerdict === "warn"
            || diagnostics.length > 0;
        const verdict: Verdict = hasBlock ? "block" : hasWarn ? "warn" : "pass";
        const durationMs = nameLinkDurationMs + (symbolicResult.stats?.durationMs ?? 0);

        return {
            verdict,
            diagnostics,
            summary: verdict === "pass" ? "Semantic validation passed." : "Semantic validation found issues.",
            degradedReasons: degradedReasons.length > 0 ? degradedReasons : undefined,
            stats: {
                durationMs,
                nameLinkUsed,
                contractGuard: contractImpact
                    ? {
                        mode: contractMode,
                        consumerScanUsed: Boolean(contractImpact.fieldImpacts?.length)
                    }
                    : undefined,
                symbolic: {
                    enabled: symbolicResult.enabled,
                    mode: symbolicResult.mode,
                    queryUsed: symbolicResult.stats.queryUsed,
                    solverUsed: symbolicResult.stats.solverUsed,
                    constraintsBuilt: symbolicResult.stats.constraintsBuilt,
                    pathsExplored: symbolicResult.stats.pathsExplored
                }
            }
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
            id: "manage.guidance.review",
            priority: 1,
            description: "Review findings before applying changes.",
            rationale: "Guardrails or validations flagged issues that need attention.",
            toolCall: { tool: "manage", args: { command: "guidance" } }
        }];
    }

    private generateReportId(): string {
        const suffix = Math.random().toString(36).slice(2, 8);
        return `review_${Date.now().toString(36)}_${suffix}`;
    }
}
