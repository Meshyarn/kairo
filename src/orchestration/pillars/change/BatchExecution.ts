import { ParsedIntent } from "../../IntentRouter.js";
import { OrchestrationContext } from "../../OrchestrationContext.js";
import { ConfigurationManager } from "../../../config/ConfigurationManager.js";
import { 
    normalizeEdits, 
    formatBatchDiff, 
    resolveBatchImpactLimit, 
    mapEditsToFiles,
    isLikelyFilePath
} from "./EditExecution.js";
import type { DependencyGraph } from "../../../ast/DependencyGraph.js";
import type { IndexStateManager } from "../../../indexing/IndexStateManager.js";
import {
  executeBatchApply,
  executeBatchDryRun
} from "./BatchExecutionHelpers.js";

export async function executeBatchChange(
  args: {
    intent: ParsedIntent;
    context: OrchestrationContext;
    rawEdits: any[];
    targetFiles: string[];
    dryRun: boolean;
    includeImpact: boolean;
    dependencyGraph?: DependencyGraph;
    indexStateManager?: IndexStateManager;
    constraints?: any;
    diffMode?: "myers" | "semantic";
    fileVersions?: Record<string, { expectedVersion?: number; expectedHash?: string }>;
    beforeApply?: () => Promise<any> | any;
  },
  runTool: (context: OrchestrationContext, tool: string, args: any) => Promise<any>,
  extractEditFilePath: (edit: any) => string | undefined,
  buildFailureGuidance: (args: any) => any
): Promise<any> {
  const { intent, context, rawEdits, targetFiles, dryRun, includeImpact, dependencyGraph, indexStateManager, constraints, diffMode, fileVersions, beforeApply } = args;
  const originalIntent = intent.originalIntent;

  if (rawEdits.length === 0) {
    return {
      success: false,
      message: "No edits provided for batch change.",
      guidance: {
        message: "Provide edits with explicit filePath or targetFiles mapping.",
        suggestedActions: []
      }
    };
  }

  const fallbackTarget = targetFiles.length === 1 ? targetFiles[0] : undefined;
  const mapped = mapEditsToFiles({ 
    targetFiles, 
    rawEdits, 
    fallbackTarget,
    extractEditFilePath
  });
  if (mapped.error || !mapped.fileEdits) {
    return {
      success: false,
      message: mapped.error?.message ?? "Batch mapping failed.",
      errorCode: mapped.error?.errorCode,
      guidance: {
        message: mapped.error?.message ?? "Provide filePath for each edit or align targetFiles with edits.",
        suggestedActions: []
      }
    };
  }

  const normalizedByFile = new Map<string, { edits: any[]; invalidEdits: any[] }>();
  for (const [filePath, editsForFile] of mapped.fileEdits.entries()) {
    const normalization = normalizeEdits(editsForFile, filePath);
    if (normalization.edits.length === 0) {
      return {
        success: false,
        message: `No valid edits provided for ${filePath}. Ensure targetContent/targetString and replacement/template are set. Example: { edits: [{ targetString: "old", replacementString: "new" }] }.`,
        invalidEdits: normalization.invalidEdits,
        guidance: {
          message: `Use read to copy exact text or provide a shorter targetString for ${filePath}. Example edits: [{ targetString: "old", replacementString: "new" }].`,
          suggestedActions: [
            {
              id: 'read.view_fragment',
              priority: 1,
              description: 'View the exact target fragment.',
              rationale: 'Accurate target text prevents edit mismatches.',
              toolCall: { tool: 'read', args: { action: 'view_fragment', target: filePath } }
            },
            {
              id: 'change.retry',
              priority: 2,
              description: 'Retry change with updated target text.',
              rationale: 'Retry after verifying the current content.',
              toolCall: { tool: 'change', args: { action: 'retry', intent: originalIntent, target: filePath } }
            }
          ]
        }
      };
    }
    normalizedByFile.set(filePath, normalization);
  }

  if (dryRun) {
    return executeBatchDryRun({
      context,
      originalIntent,
      rawEdits,
      targetFiles,
      normalizedByFile,
      includeImpact,
      batchImpactLimit: resolveBatchImpactLimit(intent.constraints),
      dependencyGraph,
      indexStateManager,
      constraints,
      diffMode,
      fileVersions
    }, runTool, buildFailureGuidance);
  }

  return executeBatchApply({
    context,
    originalIntent,
    rawEdits,
    targetFiles,
    normalizedByFile,
    includeImpact,
    batchImpactLimit: resolveBatchImpactLimit(intent.constraints),
    dependencyGraph,
    indexStateManager,
    constraints,
    fileVersions,
    beforeApply
  }, runTool, normalizedByFile);
}

export { executeV2BatchChange } from "./BatchExecutionHelpers.js";

