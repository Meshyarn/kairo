import type { OrchestrationContext } from "../../OrchestrationContext.js";
import type { FileVersionManager } from "../../../engine/FileVersionManager.js";
import type { PathNormalizer } from "../../../utils/PathNormalizer.js";
import { resolveTargetPath } from "./shared/TargetResolver.js";
import { normalizeEdits } from "./EditExecution.js";
import { extractTargetFromEdits } from "./ChangePillarEditUtils.js";
import { buildFileVersionsSnapshot } from "./ChangePillarReviewUtils.js";

export const prepareSingleTargetChange = async (args: {
  originalIntent: string;
  targets: string[];
  constraints: any;
  rawEdits: any[];
  draftTargetPath?: string;
  draftContent?: string;
  dryRun: boolean;
  fileVersionManager?: FileVersionManager;
  pathNormalizer?: PathNormalizer;
  context: OrchestrationContext;
  runTool: (ctx: OrchestrationContext, tool: string, toolArgs: any) => Promise<any>;
  buildSchemaCoaching: (args: { errorCode: string; targetPath?: string; intent?: string }) => any;
  resolvedSessionId?: string;
}): Promise<
  | { ok: true; targetPath: string; edits: any[]; useDraftApply: boolean; fileVersionsSnapshot?: Record<string, { expectedVersion?: number; expectedHash?: string }> }
  | { ok: false; response: Record<string, any> }
> => {
  let targetPath: string | undefined = args.constraints.targetPath || args.targets[0] || extractTargetFromEdits(args.rawEdits);

  let candidates: Array<{ path: string; score?: number; reason: string }> = [];
  if (!targetPath) {
    const resolved = await resolveTargetPath(args.originalIntent, args.context, (ctx, tool, toolArgs) => args.runTool(ctx, tool, toolArgs));
    targetPath = resolved.targetPath;
    candidates = resolved.candidates;
  }

  if (!targetPath && args.draftTargetPath) {
    targetPath = args.draftTargetPath;
  }

  if (!targetPath) {
    return {
      ok: false,
      response: {
        success: false,
        message: "Could not identify the target to modify.",
        candidates,
        guidance: {
          message: "Provide a target file path or select a file via navigate/search.",
          suggestedActions: [
            {
              id: "navigate.find",
              priority: 1,
              description: "Find candidate files for this change.",
              rationale: "Selecting a concrete file path is required to proceed.",
              toolCall: { tool: "navigate", args: { action: "find", target: args.originalIntent } }
            },
            {
              id: "change.retry",
              priority: 2,
              description: "Retry change with an explicit target path.",
              rationale: "Providing a file path unblocks the change flow.",
              toolCall: { tool: "change", args: { action: "retry", intent: args.originalIntent, target: "<filePath>" } }
            }
          ]
        }
      }
    };
  }

  const fileVersionsSnapshot = args.dryRun
    ? await buildFileVersionsSnapshot([targetPath], args.fileVersionManager, args.pathNormalizer)
    : undefined;

  const useDraftApply = !args.dryRun && args.rawEdits.length === 0 && Boolean(args.draftContent);
  if (useDraftApply && args.draftTargetPath && args.draftTargetPath !== targetPath) {
    return {
      ok: false,
      response: {
        success: false,
        message: "Draft target path does not match the requested target.",
        targetFile: targetPath,
        draftTarget: args.draftTargetPath,
        guidance: {
          message: "Align targetPath with the draft file or regenerate the draft for the intended target.",
          suggestedActions: [
            {
              id: "change.retry",
              priority: 1,
              description: "Retry change against the draft target path.",
              rationale: "Draft content must align with the chosen target file.",
              toolCall: { tool: "change", args: { action: "retry", intent: args.originalIntent, target: args.draftTargetPath } }
            }
          ]
        },
        sessionId: args.resolvedSessionId
      }
    };
  }

  let edits: any[] = [];
  if (!useDraftApply) {
    const normalization = normalizeEdits(args.rawEdits, targetPath);
    edits = normalization.edits;
    if (edits.length === 0) {
      return {
        ok: false,
        response: {
          success: false,
          errorCode: "SCHEMA_VALIDATION_FAILED",
          message: "No valid edits provided. Ensure targetContent/targetString and replacement/template are set. Example: { edits: [{ targetString: \"old\", replacementString: \"new\" }] }.",
          invalidEdits: normalization.invalidEdits,
          schemaCoaching: args.buildSchemaCoaching({
            errorCode: "SCHEMA_VALIDATION_FAILED",
            targetPath,
            intent: args.originalIntent
          }),
          guidance: {
            message: "Use read to copy exact text or provide a shorter targetString. Example edits: [{ targetString: \"old\", replacementString: \"new\" }].",
            suggestedActions: [
              {
                id: "read.view_fragment",
                priority: 1,
                description: "View the exact target fragment.",
                rationale: "Accurate target text prevents edit mismatches.",
                toolCall: { tool: "read", args: { action: "view_fragment", target: targetPath } }
              },
              {
                id: "change.retry",
                priority: 2,
                description: "Retry change with updated target text.",
                rationale: "Retry with corrected target string.",
                toolCall: { tool: "change", args: { action: "retry", intent: args.originalIntent, target: targetPath } }
              }
            ]
          },
          sessionId: args.resolvedSessionId
        }
      };
    }
  } else if (!args.draftContent) {
    return {
      ok: false,
      response: {
        success: false,
        message: "Draft content not available for apply.",
        targetFile: targetPath,
        guidance: {
          message: "Re-run a dryRun to generate a DraftPack before applying.",
          suggestedActions: [
            {
              id: "change.plan",
              priority: 1,
              description: "Generate a new plan (dryRun).",
              rationale: "Draft content is required to apply without edits.",
              toolCall: { tool: "change", args: { action: "plan", intent: args.originalIntent, target: targetPath } }
            }
          ]
        },
        sessionId: args.resolvedSessionId
      }
    };
  }

  return {
    ok: true,
    targetPath,
    edits,
    useDraftApply,
    fileVersionsSnapshot
  };
};
