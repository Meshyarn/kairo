import type { ParsedIntent } from "../../IntentRouter.js";
import type { OrchestrationContext } from "../../OrchestrationContext.js";
import type { DependencyGraph } from "../../../ast/DependencyGraph.js";
import type { IndexStateManager } from "../../../indexing/IndexStateManager.js";
import type { FileVersionManager } from "../../../engine/FileVersionManager.js";
import type { PathNormalizer } from "../../../utils/PathNormalizer.js";
import type { EditResolver } from "../../../engine/EditResolver.js";
import type { EditCoordinator } from "../../../engine/EditCoordinator.js";
import { executeBatchChange, executeV2BatchChange } from "./BatchExecution.js";
import { buildDegradedReasons } from "../../DegradedReasonMapper.js";
import { buildFileVersionsSnapshot, detectFileVersionMismatch, buildFailureGuidance } from "./ChangePillarReviewUtils.js";
import { extractEditFilePath } from "./ChangePillarEditUtils.js";

export const runBatchChangeFlow = async (args: {
  shouldBatch: boolean;
  useV2: boolean;
  v2Mode: string;
  intent: ParsedIntent;
  context: OrchestrationContext;
  rawEdits: any[];
  targetFiles: string[];
  dryRun: boolean;
  includeImpact: boolean;
  dependencyGraph?: DependencyGraph;
  indexStateManager?: IndexStateManager;
  constraints: any;
  diffMode?: "myers" | "semantic";
  expectedFileVersions?: Record<string, { expectedVersion?: number; expectedHash?: string }>;
  fileVersionManager?: FileVersionManager;
  pathNormalizer?: PathNormalizer;
  consumeApplyTokenOnce: () => any | null;
  invalidateApplyTokenOnDrift: () => void;
  attachWorkflow: <T extends Record<string, any>>(payload: T) => any;
  runTool: (ctx: OrchestrationContext, tool: string, toolArgs: any) => Promise<any>;
  getEditResolver: () => EditResolver;
  getEditCoordinator: () => EditCoordinator;
  originalIntent: string;
  resolvedSessionId?: string;
}): Promise<any | null> => {
  if (!args.shouldBatch) return null;

  if (args.useV2) {
    const tokenBlock = args.consumeApplyTokenOnce();
    if (tokenBlock) {
      return args.attachWorkflow(tokenBlock);
    }
    const result = await executeV2BatchChange(
      { intent: args.intent, context: args.context, rawEdits: args.rawEdits, targetFiles: args.targetFiles, dryRun: args.dryRun, v2Mode: args.v2Mode },
      args.getEditResolver,
      args.getEditCoordinator
    );
    return args.attachWorkflow(result);
  }

  const batchFileVersions = args.dryRun
    ? await buildFileVersionsSnapshot(args.targetFiles, args.fileVersionManager, args.pathNormalizer)
    : args.expectedFileVersions;
  if (!args.dryRun && batchFileVersions && args.fileVersionManager && args.pathNormalizer) {
    const mismatch = await detectFileVersionMismatch(batchFileVersions, args.fileVersionManager, args.pathNormalizer);
    if (mismatch) {
      const degradedReasons = buildDegradedReasons(["file_version_mismatch"], { filePath: mismatch.filePath });
      args.invalidateApplyTokenOnDrift();
      return args.attachWorkflow({
        success: false,
        status: "blocked",
        message: "File version mismatch detected. Re-read the file(s) before retrying the change.",
        errorCode: "FILE_VERSION_MISMATCH",
        blockedReason: "file_version_mismatch",
        degradedReasons,
        guidance: {
          message: "One or more files changed since planning. Re-read and re-plan before applying.",
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
      });
    }
  }

  const result = await executeBatchChange(
    {
      intent: args.intent,
      context: args.context,
      rawEdits: args.rawEdits,
      targetFiles: args.targetFiles,
      dryRun: args.dryRun,
      includeImpact: args.includeImpact,
      dependencyGraph: args.dependencyGraph,
      indexStateManager: args.indexStateManager,
      constraints: args.constraints,
      diffMode: args.diffMode,
      fileVersions: batchFileVersions,
      beforeApply: args.dryRun ? undefined : () => args.consumeApplyTokenOnce()
    },
    (ctx, tool, toolArgs) => args.runTool(ctx, tool, toolArgs),
    (edit) => extractEditFilePath(edit),
    (failureArgs) => buildFailureGuidance(failureArgs)
  );
  return args.attachWorkflow(result);
};
