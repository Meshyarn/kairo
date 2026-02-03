import type { OrchestrationContext } from "../../OrchestrationContext.js";
import type { FileVersionManager } from "../../../engine/FileVersionManager.js";
import type { PathNormalizer } from "../../../utils/PathNormalizer.js";
import { detectFileVersionMismatch } from "./ChangePillarReviewUtils.js";
import { buildDegradedReasons } from "../../DegradedReasonMapper.js";
import { AstManager } from "../../../ast/AstManager.js";
import { metrics } from "../../../utils/MetricsCollector.js";

export const runEditTransactionFlow = async (args: {
  context: OrchestrationContext;
  targetPath: string;
  edits: any[];
  dryRun: boolean;
  diffMode?: "myers" | "semantic";
  allowImpactPreview: boolean;
  expectedFileVersions?: Record<string, { expectedVersion?: number; expectedHash?: string }>;
  fileVersionManager?: FileVersionManager;
  pathNormalizer?: PathNormalizer;
  consumeApplyTokenOnce: () => any | null;
  invalidateApplyTokenOnDrift: () => void;
  budget: { allowNormalization: boolean; allowLevenshtein: boolean; maxLevenshteinTargetLength: number; maxMatchAttempts: number };
  originalIntent: string;
  resolvedSessionId?: string;
  runTool: (ctx: OrchestrationContext, tool: string, toolArgs: any) => Promise<any>;
}): Promise<{
  finalResult?: any;
  autoCorrected: boolean;
  autoCorrectionAttempts: string[];
  blockedResponse?: Record<string, any>;
}> => {
  const fileVersions = !args.dryRun ? args.expectedFileVersions : undefined;
  if (!args.dryRun && fileVersions && args.fileVersionManager && args.pathNormalizer) {
    const mismatch = await detectFileVersionMismatch(fileVersions, args.fileVersionManager, args.pathNormalizer);
    if (mismatch) {
      const degradedReasons = buildDegradedReasons(["file_version_mismatch"], { filePath: mismatch.filePath });
      args.invalidateApplyTokenOnDrift();
      return {
        autoCorrected: false,
        autoCorrectionAttempts: [],
        blockedResponse: {
          success: false,
          status: "blocked",
          message: "File version mismatch detected. Re-read the file before retrying the change.",
          targetFile: mismatch.filePath,
          errorCode: "FILE_VERSION_MISMATCH",
          blockedReason: "file_version_mismatch",
          degradedReasons,
          guidance: {
            message: "The file changed since it was read. Re-read and re-plan before applying.",
            suggestedActions: [
              {
                id: "read.view_full",
                priority: 1,
                description: "Re-read the latest file content.",
                rationale: "Refresh context before reapplying changes.",
                tags: ["repair_ladder", "attempt_1"],
                toolCall: { tool: "read", args: { action: "view_full", target: mismatch.filePath } }
              },
              {
                id: "change.plan",
                priority: 2,
                description: "Re-plan the change using the latest content.",
                rationale: "Ensure edits are based on the current file state.",
                tags: ["repair_ladder", "attempt_2"],
                toolCall: { tool: "change", args: { action: "plan", intent: args.originalIntent, target: mismatch.filePath } }
              }
            ]
          },
          sessionId: args.resolvedSessionId
        }
      };
    }
  }

  const tokenBlock = args.consumeApplyTokenOnce();
  if (tokenBlock) {
    return { autoCorrected: false, autoCorrectionAttempts: [], blockedResponse: tokenBlock };
  }

  const stopEdit = metrics.startTimer("change.edit_coordinator_ms");
  let editResult: any;
  try {
    editResult = await args.runTool(args.context, "edit_transaction", {
      filePath: args.targetPath,
      edits: args.edits,
      dryRun: args.dryRun,
      options: {
        skipImpactPreview: args.dryRun && !args.allowImpactPreview,
        ...(args.diffMode ? { diffMode: args.diffMode } : {})
      },
      fileVersions
    });
  } finally {
    stopEdit();
  }

  if (!editResult.success && editResult.errorCode === "FILE_VERSION_MISMATCH" && args.targetPath) {
    const degradedReasons = buildDegradedReasons(["file_version_mismatch"], { filePath: args.targetPath });
    args.invalidateApplyTokenOnDrift();
    return {
      autoCorrected: false,
      autoCorrectionAttempts: [],
      blockedResponse: {
        success: false,
        status: "blocked",
        message: "File version mismatch detected. Re-read the file before retrying the change.",
        targetFile: args.targetPath,
        errorCode: "FILE_VERSION_MISMATCH",
        blockedReason: "file_version_mismatch",
        degradedReasons,
        currentFileStates: editResult.updatedFileStates,
        guidance: {
          message: "The file changed since it was read. Re-read and re-plan before applying.",
          suggestedActions: [
            {
              id: "read.view_full",
              priority: 1,
              description: "Re-read the latest file content.",
              rationale: "Refresh context before reapplying changes.",
              tags: ["repair_ladder", "attempt_1"],
              toolCall: { tool: "read", args: { action: "view_full", target: args.targetPath } }
            },
            {
              id: "change.plan",
              priority: 2,
              description: "Re-plan the change using the latest content.",
              rationale: "Ensure edits are based on the current file state.",
              tags: ["repair_ladder", "attempt_2"],
              toolCall: { tool: "change", args: { action: "plan", intent: args.originalIntent, target: args.targetPath } }
            }
          ]
        },
        sessionId: args.resolvedSessionId
      }
    };
  }

  if (!editResult.success && editResult.errorCode === "SYNTAX_VALIDATION_FAILED" && args.targetPath) {
    const astManager = AstManager.getInstance();
    const languageId = astManager.getLanguageId(args.targetPath);
    const degradedReasons = buildDegradedReasons(["syntax_validation_failed"], { languageId, filePath: args.targetPath });
    const message = editResult.message ?? "Syntax validation failed.";
    return {
      autoCorrected: false,
      autoCorrectionAttempts: [],
      blockedResponse: {
        success: false,
        status: "blocked",
        message,
        targetFile: args.targetPath,
        errorCode: editResult.errorCode,
        blockedReason: "syntax_validation_failed",
        blockingErrors: ["SYNTAX_VALIDATION_FAILED"],
        degradedReasons,
        validationSummary: editResult.validationSummary,
        guidance: { message },
        sessionId: args.resolvedSessionId
      }
    };
  }

  let finalResult = editResult;
  let autoCorrected = false;
  const autoCorrectionAttempts: string[] = [];

  let allowLevenshtein = args.budget.allowLevenshtein;
  if (allowLevenshtein) {
    const minTargetLength = 24;
    const tooShort = args.edits.some((edit: any) => (edit?.targetString?.length ?? 0) < minTargetLength);
    if (tooShort) {
      allowLevenshtein = false;
    } else {
      try {
        const stat = await args.runTool(args.context, "file_stat", { path: args.targetPath });
        if (typeof stat?.size === "number" && stat.size > 262144) {
          allowLevenshtein = false;
        }
      } catch {
        // ignore
      }
    }
  }

  if (!editResult.success && args.edits.length > 0) {
    const attempts: Array<{ label: string; edits: any[] }> = [];
    if (args.budget.allowNormalization) {
      attempts.push({ label: "whitespace", edits: args.edits.map((edit: any) => ({ ...edit, fuzzyMode: edit.fuzzyMode ?? "whitespace" })) });
      attempts.push({ label: "structural", edits: args.edits.map((edit: any) => ({ ...edit, normalization: edit.normalization ?? "structural" })) });
    }
    if (allowLevenshtein) {
      const eligible = args.edits.every((edit: any) => (edit?.targetString?.length ?? 0) <= args.budget.maxLevenshteinTargetLength);
      if (eligible) {
        attempts.push({ label: "fuzzy", edits: args.edits.map((edit: any) => ({ ...edit, fuzzyMode: edit.fuzzyMode ?? "levenshtein" })) });
      }
    }
    const maxAttempts = Math.max(0, args.budget.maxMatchAttempts - 1);
    const limitedAttempts = attempts.slice(0, maxAttempts);
    autoCorrectionAttempts.push(...limitedAttempts.map(attempt => attempt.label));
    for (const attempt of limitedAttempts) {
      const stopCorrect = metrics.startTimer("change.edit_coordinator_ms");
      let correctedResult: any;
      try {
        correctedResult = await args.runTool(args.context, "edit_transaction", {
          filePath: args.targetPath,
          edits: attempt.edits,
          dryRun: args.dryRun,
          options: args.diffMode ? { diffMode: args.diffMode } : undefined,
          fileVersions
        });
      } finally {
        stopCorrect();
      }
      if (!correctedResult.success && correctedResult.errorCode === "FILE_VERSION_MISMATCH" && args.targetPath) {
        const degradedReasons = buildDegradedReasons(["file_version_mismatch"], { filePath: args.targetPath });
        args.invalidateApplyTokenOnDrift();
        return {
          autoCorrected: false,
          autoCorrectionAttempts,
          blockedResponse: {
            success: false,
            status: "blocked",
            message: "File version mismatch detected. Re-read the file before retrying the change.",
            targetFile: args.targetPath,
            errorCode: "FILE_VERSION_MISMATCH",
            blockedReason: "file_version_mismatch",
            degradedReasons,
            currentFileStates: correctedResult.updatedFileStates,
            guidance: {
              message: "The file changed since it was read. Re-read and re-plan before applying.",
              suggestedActions: [
                {
                  id: "read.view_full",
                  priority: 1,
                  description: "Re-read the latest file content.",
                  rationale: "Refresh context before reapplying changes.",
                  tags: ["repair_ladder", "attempt_1"],
                  toolCall: { tool: "read", args: { action: "view_full", target: args.targetPath } }
                },
                {
                  id: "change.plan",
                  priority: 2,
                  description: "Re-plan the change using the latest content.",
                  rationale: "Ensure edits are based on the current file state.",
                  tags: ["repair_ladder", "attempt_2"],
                  toolCall: { tool: "change", args: { action: "plan", intent: args.originalIntent, target: args.targetPath } }
                }
              ]
            },
            sessionId: args.resolvedSessionId
          }
        };
      }
      if (correctedResult.success) {
        finalResult = correctedResult;
        autoCorrected = true;
        break;
      }
    }
  }

  return { finalResult, autoCorrected, autoCorrectionAttempts };
};
