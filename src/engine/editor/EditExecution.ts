import * as path from "path";
import { ConfigurationManager } from "../../config/ConfigurationManager.js";
import { MyersDiff } from "../Diff.js";
import { PatienceDiff } from "../PatienceDiff.js";
import { EngineManager } from "../../orchestration/capabilities/EngineManager.js";
import { CAP_DIFF_UNIFIED } from "../../orchestration/capabilities/CapabilityIds.js";
import type { IDiffingProvider } from "../../orchestration/capabilities/Diffing.js";
import type {
    DiffMode,
    Edit,
    EditResult,
    ValidationMode,
    ValidationResult,
    ValidationSummary,
    SemanticDiffProvider,
    SemanticDiffSummary,
    ToolSuggestion
} from "../../types.js";
import type { IFileSystem } from "../../platform/FileSystem.js";
import {
    AmbiguousMatchError,
    ApplyEditsOptions,
    HashMismatchError,
    Match,
    MatchNotFoundError
} from "./EditTypes.js";
import { BackupManager } from "./EditIntegrity.js";
import { buildEditOperation } from "./EditTelemetry.js";
import { EditPlanner } from "./EditPlanning.js";
import { SyntaxValidator } from "../validators/syntax-validator.js";
import { SyntaxValidationError } from "../../errors/SyntaxValidationError.js";
import { SemanticValidator } from "../validators/semantic-validator.js";
import { TextNormalizer } from "../../utils/textNormalization.js";

interface EditExecutorOptions {
    rootPath: string;
    fileSystem: IFileSystem;
    semanticDiffProvider?: SemanticDiffProvider;
    planner: EditPlanner;
    backupManager: BackupManager;
}

export class EditExecutor {
    private readonly rootPath: string;
    private readonly fileSystem: IFileSystem;
    private readonly semanticDiffProvider?: SemanticDiffProvider;
    private readonly planner: EditPlanner;
    private readonly backupManager: BackupManager;
    private readonly syntaxValidator?: SyntaxValidator;
    private readonly semanticValidator?: SemanticValidator;
    private readonly syntaxValidationMode: ValidationMode;
    private readonly semanticValidationMode: ValidationMode;

    constructor(options: EditExecutorOptions) {
        this.rootPath = options.rootPath;
        this.fileSystem = options.fileSystem;
        this.semanticDiffProvider = options.semanticDiffProvider;
        this.planner = options.planner;
        this.backupManager = options.backupManager;

        const validationConfig = ConfigurationManager.getValidationConfig();
        this.syntaxValidationMode = validationConfig.syntax;
        this.semanticValidationMode = validationConfig.semantic;
        if (validationConfig.syntax !== "off") {
            this.syntaxValidator = new SyntaxValidator();
        }
        if (validationConfig.semantic !== "off") {
            this.semanticValidator = new SemanticValidator({ rootPath: this.rootPath });
        }
    }

    private buildSuggestion(code: string, filePath: string, edit?: Edit): ToolSuggestion | undefined {
        const relativePath = path.relative(this.rootPath, filePath);
        const buildArgs = (extras: Record<string, unknown>): Record<string, unknown> => {
            const args: Record<string, unknown> = { filePath: relativePath, ...extras };
            Object.keys(args).forEach(key => args[key] === undefined && delete args[key]);
            return args;
        };

        switch (code) {
            case "NO_MATCH":
                return {
                    toolName: "debug_edit_match",
                    rationale: "Check normalization and anchors before retrying the edit.",
                    exampleArgs: buildArgs({
                        targetString: edit?.targetString,
                        lineRange: edit?.lineRange,
                        normalization: edit?.normalization ?? "whitespace"
                    })
                };
            case "AMBIGUOUS_MATCH":
                return {
                    toolName: "debug_edit_match",
                    rationale: "Identify conflicting regions and tighten lineRange or context before retrying.",
                    exampleArgs: buildArgs({
                        targetString: edit?.targetString,
                        lineRange: edit?.lineRange
                    })
                };
            case "HASH_MISMATCH":
                return {
                    toolName: "file_read",
                    rationale: "Re-read the Smart File Profile to refresh hashes before editing again.",
                    exampleArgs: buildArgs({})
                };
            default:
                return undefined;
        }
    }

    public async applyEdits(
        filePath: string,
        edits: Edit[],
        dryRun: boolean = false,
        options?: ApplyEditsOptions
    ): Promise<EditResult> {
        if (!(await this.fileSystem.exists(filePath))) {
            return { success: false, message: `File not found: ${filePath}` };
        }
        const diffMode: DiffMode = options?.diffMode === "semantic" ? "semantic" : "myers";

        const originalContent = await this.fileSystem.readFile(filePath);
        let plannedMatches: Match[];

        try {
            plannedMatches = this.planner.applyEditsInternal(originalContent, edits);
        } catch (error: any) {
            const failingEdit = (error as any).edit as Edit | undefined;
            if (error instanceof AmbiguousMatchError) {
                return {
                    success: false,
                    message: error.message,
                    details: { conflictingLines: error.conflictingLines },
                    suggestion: this.buildSuggestion("AMBIGUOUS_MATCH", filePath, failingEdit),
                    errorCode: "AMBIGUOUS_MATCH",
                };
            }
            if (error instanceof MatchNotFoundError) {
                return {
                    success: false,
                    message: error.message,
                    errorCode: "NO_MATCH",
                    suggestion: this.buildSuggestion("NO_MATCH", filePath, failingEdit)
                };
            }
            if (error instanceof HashMismatchError) {
                return {
                    success: false,
                    message: error.message,
                    errorCode: "HASH_MISMATCH",
                    suggestion: this.buildSuggestion("HASH_MISMATCH", filePath, failingEdit)
                };
            }
            return { success: false, message: error.message };
        }

        let newContent = "";
        let lastCursor = 0;
        const inverseEdits: Edit[] = [];
        const targetEOL = TextNormalizer.detectEOL(originalContent) ?? "\n";

        for (const match of plannedMatches) {
            const unchanged = originalContent.substring(lastCursor, match.start);
            newContent += unchanged;

            const newStart = newContent.length;
            const normalizedReplacement = TextNormalizer.normalizeForFileSystem(match.replacement, {
                unescapeNewlines: true,
                trimTrailing: true,
                targetEOL
            });
            newContent += normalizedReplacement;
            const newEnd = newStart + normalizedReplacement.length;

            inverseEdits.push({
                targetString: normalizedReplacement,
                replacementString: match.original,
                indexRange: { start: newStart, end: newEnd },
            });

            lastCursor = match.end;
        }
        newContent += originalContent.substring(lastCursor);

        const operation = buildEditOperation(filePath, edits, inverseEdits);
        const syntaxValidation = await this.runSyntaxValidation(filePath, newContent);
        if (syntaxValidation && this.syntaxValidationMode === "error" && !syntaxValidation.result.success) {
            const error = new SyntaxValidationError(
                "Edit would introduce syntax errors.",
                syntaxValidation.summary.blockingErrors
            );
            return {
                success: false,
                message: error.message,
                errorCode: "SYNTAX_VALIDATION_FAILED",
                details: { diagnostics: error.diagnostics },
                validationSummary: syntaxValidation.summary
            };
        }

        const semanticValidation = await this.runSemanticValidation(filePath, newContent);
        if (semanticValidation && this.semanticValidationMode === "error" && !semanticValidation.result.success) {
            const validationSummary = this.mergeValidationSummaries(
                syntaxValidation?.summary,
                semanticValidation.summary
            );
            return {
                success: false,
                message: "Edit would introduce semantic issues.",
                errorCode: "SEMANTIC_VALIDATION_FAILED",
                details: { diagnostics: validationSummary?.blockingErrors ?? [] },
                validationSummary
            };
        }

        const validationSummary = this.mergeValidationSummaries(
            syntaxValidation?.summary,
            semanticValidation?.summary
        );

        if (dryRun) {
            let diffText: string;
            let added = 0;
            let removed = 0;
            let semanticSummary: SemanticDiffSummary | undefined;

            if (diffMode === "semantic") {
                const diffProvider = EngineManager.getProvider<IDiffingProvider>(CAP_DIFF_UNIFIED);
                if (diffProvider) {
                    const result = diffProvider.diffUnified(originalContent, newContent, 3);
                    diffText = result.diff;
                    added = result.added;
                    removed = result.removed;
                } else {
                    const hunks = PatienceDiff.diff(originalContent, newContent, {
                        contextLines: 3,
                        semantic: true
                    });
                    const summary = PatienceDiff.summarize(hunks);
                    diffText = PatienceDiff.formatUnified(hunks);
                    added = summary.added;
                    removed = summary.removed;
                }
                if (this.semanticDiffProvider) {
                    semanticSummary = await this.semanticDiffProvider.diff(filePath, originalContent, newContent);
                }
            } else {
                const summary = MyersDiff.diffLinesStructured(originalContent, newContent);
                diffText = summary.diff;
                added = summary.added;
                removed = summary.removed;
            }
            const relativePath = path.relative(this.rootPath, filePath);
            return {
                success: true,
                message: diffText,
                originalContent,
                newContent,
                diff: diffText,
                structuredDiff: [{
                    filePath: relativePath,
                    diff: diffText,
                    added,
                    removed
                }],
                semanticSummary,
                diffModeUsed: diffMode,
                operation,
                validationSummary
            };
        }

        const relativePath = path.relative(this.rootPath, filePath);
        await this.backupManager.createTimestampedBackup(relativePath, originalContent);
        await this.backupManager.enforceRetentionPolicy(relativePath);
        await this.fileSystem.writeFile(filePath, newContent);

        return {
            success: true,
            message: `Successfully applied ${edits.length} edits.`,
            diffModeUsed: diffMode,
            operation: {
                ...operation,
                filePath: relativePath,
            },
            validationSummary
        };
    }

    private async runSyntaxValidation(
        filePath: string,
        content: string
    ): Promise<{ result: ValidationResult; summary: ValidationSummary } | undefined> {
        if (!this.syntaxValidator || this.syntaxValidationMode === "off") {
            return undefined;
        }

        const result = await this.syntaxValidator.validate(filePath, content);
        const summary = this.buildValidationSummary(result, this.syntaxValidationMode, {
            syntaxChecked: true,
            semanticChecked: false
        });
        return { result, summary };
    }

    private async runSemanticValidation(
        filePath: string,
        content: string
    ): Promise<{ result: ValidationResult; summary: ValidationSummary } | undefined> {
        if (!this.semanticValidator || this.semanticValidationMode === "off") {
            return undefined;
        }

        const result = await this.semanticValidator.validate(filePath, content);
        const summary = this.buildValidationSummary(result, this.semanticValidationMode, {
            syntaxChecked: false,
            semanticChecked: true
        });
        return { result, summary };
    }

    private buildValidationSummary(
        result: ValidationResult,
        mode: ValidationMode,
        checked: { syntaxChecked: boolean; semanticChecked: boolean }
    ): ValidationSummary {
        const blockingErrors = [...(result.blockingErrors ?? [])];
        const warnings = [...(result.warnings ?? [])];
        const durationMs = result.durationMs ?? 0;

        if (!result.success && mode === "warn" && blockingErrors.length > 0) {
            warnings.push(...blockingErrors);
            blockingErrors.length = 0;
        }

        return {
            success: result.success,
            blockingErrors,
            warnings,
            durationMs,
            syntaxChecked: checked.syntaxChecked,
            semanticChecked: checked.semanticChecked
        };
    }

    private mergeValidationSummaries(
        ...summaries: Array<ValidationSummary | undefined>
    ): ValidationSummary | undefined {
        const present = summaries.filter(Boolean) as ValidationSummary[];
        if (present.length === 0) {
            return undefined;
        }

        const blockingErrors: ValidationSummary["blockingErrors"] = [];
        const warnings: ValidationSummary["warnings"] = [];
        let durationMs = 0;
        let syntaxChecked = false;
        let semanticChecked = false;

        for (const summary of present) {
            blockingErrors.push(...summary.blockingErrors);
            warnings.push(...summary.warnings);
            durationMs += summary.durationMs;
            syntaxChecked = syntaxChecked || summary.syntaxChecked;
            semanticChecked = semanticChecked || summary.semanticChecked;
        }

        return {
            success: present.every(summary => summary.success),
            blockingErrors,
            warnings,
            durationMs,
            syntaxChecked,
            semanticChecked
        };
    }
}
