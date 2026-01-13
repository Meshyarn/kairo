import { ParsedIntent } from "../../IntentRouter.js";
import { OrchestrationContext } from "../../OrchestrationContext.js";
import { metrics } from "../../../utils/MetricsCollector.js";
import { ConfigurationManager } from "../../../config/ConfigurationManager.js";
import { 
    normalizeEdits, 
    formatBatchDiff, 
    resolveBatchImpactLimit, 
    mapEditsToFiles,
    isLikelyFilePath
} from "./EditExecution.js";
import {
    applyEditsToContent,
    evaluateIntegrityGuardrails,
    normalizeGuardrailContent,
    resolveGuardrailTargetPath
} from "../../guardrails/IntegrityGuardrails.js";
import type { DependencyGraph } from "../../../ast/DependencyGraph.js";
import type { IndexStateManager } from "../../../indexing/IndexStateManager.js";

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
  },
  runTool: (context: OrchestrationContext, tool: string, args: any) => Promise<any>,
  extractEditFilePath: (edit: any) => string | undefined,
  buildFailureGuidance: (args: any) => any
): Promise<any> {
  const { intent, context, rawEdits, targetFiles, dryRun, includeImpact, dependencyGraph, indexStateManager, constraints, diffMode, fileVersions } = args;
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
        message: `No valid edits provided for ${filePath}. Ensure targetContent/targetString and replacement/template are set.`,
        invalidEdits: normalization.invalidEdits,
        guidance: {
          message: `Use read to copy exact text or provide a shorter targetString for ${filePath}.`,
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
    fileVersions
  }, runTool, normalizedByFile);
}

async function executeBatchDryRun(
  args: {
    context: OrchestrationContext;
    originalIntent: string;
    rawEdits: any[];
    targetFiles: string[];
    normalizedByFile: Map<string, { edits: any[] }>;
    includeImpact: boolean;
    batchImpactLimit: number;
    dependencyGraph?: DependencyGraph;
    indexStateManager?: IndexStateManager;
    constraints?: any;
    diffMode?: "myers" | "semantic";
    fileVersions?: Record<string, { expectedVersion?: number; expectedHash?: string }>;
  },
  runTool: (context: OrchestrationContext, tool: string, args: any) => Promise<any>,
  buildFailureGuidance: (args: any) => any
): Promise<any> {
  const { context, originalIntent, rawEdits, targetFiles, normalizedByFile, includeImpact, batchImpactLimit, dependencyGraph, indexStateManager, constraints, diffMode, fileVersions } = args;
  const results: Array<{ filePath: string; success: boolean; diff?: string; error?: string }> = [];
  const planSteps: Array<{ action: 'modify'; file: string; description: string; diff?: string }> = [];
  const diffBlocks: string[] = [];
  const impactReports: Array<{ filePath: string; preview?: any }> = [];
  const guardrailResults: Array<{ filePath: string; result: any }> = [];
  let remainingImpact = includeImpact ? Math.max(0, batchImpactLimit) : 0;

  for (const [filePath, normalization] of normalizedByFile.entries()) {
    try {
      let existingContent = "";
      try {
        const raw = await runTool(context, "code_read", { filePath, view: "full" });
        existingContent = typeof raw === "string" ? raw : "";
      } catch {
        existingContent = "";
      }
      let nextContent = existingContent;
      try {
        nextContent = applyEditsToContent(existingContent, normalization.edits).newContent;
      } catch {
        nextContent = existingContent;
      }
      const guardrail = await evaluateIntegrityGuardrails({
        targetPath: resolveGuardrailTargetPath(filePath),
        oldContent: normalizeGuardrailContent(existingContent),
        newContent: normalizeGuardrailContent(nextContent),
        edits: normalization.edits,
        dependencyGraph,
        indexStateManager,
        constraints,
        runTool: (tool, args) => runTool(context, tool, args),
        applyMode: false
      });
      guardrailResults.push({ filePath, result: guardrail });
    } catch {
      // Guardrail evaluation is best-effort in dryRun
    }

    const stopEdit = metrics.startTimer("change.edit_coordinator_ms");
    let editResult: any;
    try {
      editResult = await runTool(context, 'edit_transaction', {
        filePath,
        edits: normalization.edits,
        dryRun: true,
        options: {
          skipImpactPreview: remainingImpact <= 0,
          ...(diffMode ? { diffMode } : {})
        }
      });
    } finally {
      stopEdit();
    }
    if (!editResult.success) {
      const failureMessage = editResult.message ?? editResult.details?.message ?? "Batch dry run failed.";
      const failureGuidance = buildFailureGuidance({
        intent: originalIntent,
        targetPath: filePath,
        edits: normalization.edits,
        dryRun: true,
        failureMessage,
        autoCorrectionAttempts: []
      });
      results.push({ filePath, success: false, error: failureMessage });
      return {
        success: false,
        message: `Dry run failed for file ${filePath}: ${failureMessage}`,
        operation: "plan",
        results,
        guidance: failureGuidance
      };
    }
    results.push({ filePath, success: true, diff: editResult.diff });
    planSteps.push({
      action: 'modify' as const,
      file: filePath,
      description: originalIntent,
      diff: editResult.diff
    });
    if (remainingImpact > 0) {
      if (editResult?.impactPreview) {
        impactReports.push({ filePath, preview: editResult.impactPreview });
      }
      remainingImpact -= 1;
    }
    if (typeof editResult.diff === "string" && editResult.diff.length > 0) {
      diffBlocks.push(formatBatchDiff(filePath, editResult.diff));
    }
  }

  const successGuidance = {
    message: "Batch change plan generated. Review the diffs before applying.",
    suggestedActions: [
      {
        id: "change.apply",
        priority: 1,
        description: "Apply the batch change plan.",
        rationale: "Plan completed successfully; apply to update files.",
        toolCall: {
          tool: "change",
          args: {
            action: "apply",
            intent: originalIntent,
            targetFiles,
            edits: rawEdits,
            options: { dryRun: false, batchMode: true },
            ...(fileVersions ? { fileVersions } : {})
          }
        }
      }
    ]
  };

  return {
    success: true,
    operation: "plan",
    diff: diffBlocks.join("\n\n"),
    plan: { steps: planSteps },
    results,
    fileVersions: fileVersions && Object.keys(fileVersions).length > 0 ? fileVersions : undefined,
    impactReports: impactReports.length > 0 ? impactReports : undefined,
    guardrailResults: guardrailResults.length > 0 ? guardrailResults : undefined,
    guidance: successGuidance
  };
}

async function executeBatchApply(
  args: {
    context: OrchestrationContext;
    originalIntent: string;
    rawEdits: any[];
    targetFiles: string[];
    normalizedByFile: Map<string, { edits: any[] }>;
    includeImpact: boolean;
    batchImpactLimit: number;
    dependencyGraph?: DependencyGraph;
    indexStateManager?: IndexStateManager;
    constraints?: any;
    fileVersions?: Record<string, { expectedVersion?: number; expectedHash?: string }>;
  },
  runTool: (context: OrchestrationContext, tool: string, args: any) => Promise<any>,
  normalizedByFile: Map<string, { edits: any[] }>
): Promise<any> {
  const { context, originalIntent, rawEdits, targetFiles, includeImpact, batchImpactLimit, dependencyGraph, indexStateManager, constraints, fileVersions } = args;
  const batchEdits: any[] = [];
  for (const [filePath, normalization] of normalizedByFile.entries()) {
    for (const edit of normalization.edits) {
      batchEdits.push({ ...edit, filePath });
    }
  }

  for (const [filePath, normalization] of normalizedByFile.entries()) {
    let existingContent = "";
    try {
      const raw = await runTool(context, "code_read", { filePath, view: "full" });
      existingContent = typeof raw === "string" ? raw : "";
    } catch {
      existingContent = "";
    }
    let nextContent = existingContent;
    try {
      nextContent = applyEditsToContent(existingContent, normalization.edits).newContent;
    } catch {
      nextContent = existingContent;
    }
    const guardrail = await evaluateIntegrityGuardrails({
      targetPath: resolveGuardrailTargetPath(filePath),
      oldContent: normalizeGuardrailContent(existingContent),
      newContent: normalizeGuardrailContent(nextContent),
      edits: normalization.edits,
      dependencyGraph,
      indexStateManager,
      constraints,
      runTool: (tool, args) => runTool(context, tool, args),
      applyMode: true
    });
    if (guardrail?.status === "block") {
      return {
        success: false,
        status: "blocked",
        message: guardrail.violations?.[0]?.message ?? "Batch change blocked by integrity guardrails.",
        operation: "apply",
        targetFile: filePath,
        architecturalRisk: guardrail.architecturalRisk,
        architecturalWarnings: guardrail.architecturalWarnings,
        blockingErrors: guardrail.blockingErrors,
        errorCode: guardrail.errorCode ?? "ARCHITECTURE_BLOCKED",
        blockedReason: guardrail.blockedReason ?? "architectural_violation",
        safetyChecklist: guardrail.safetyChecklist,
        violations: guardrail.violations,
        warnings: guardrail.warnings,
        guidance: {
          message: guardrail.violations?.[0]?.message ?? "Resolve guardrail violations before retrying."
        }
      };
    }
  }

  const stopEditCode = metrics.startTimer("change.edit_code_ms");
  let editResult: any;
  try {
    editResult = await runTool(context, "edit_apply", {
      edits: batchEdits,
      dryRun: false,
      fileVersions
    });
  } finally {
    stopEditCode();
  }
  if (editResult?.errorCode === "FILE_VERSION_MISMATCH") {
    return {
      success: false,
      status: "blocked",
      message: "File version mismatch detected. Re-read the files before retrying the batch apply.",
      errorCode: "FILE_VERSION_MISMATCH",
      blockedReason: "file_version_mismatch",
      currentFileStates: editResult.updatedFileStates,
      guidance: {
        message: "Files changed since the plan. Re-read and re-plan before applying.",
        suggestedActions: [
          {
            id: "read.view_full",
            priority: 1,
            description: "Re-read the latest file content.",
            rationale: "Refresh context before reapplying changes.",
            toolCall: { tool: "read", args: { action: "view_full", target: targetFiles[0] ?? "" } }
          },
          {
            id: "change.plan",
            priority: 2,
            description: "Re-plan the batch change.",
            rationale: "Ensure edits match the latest file states.",
            toolCall: { tool: "change", args: { action: "plan", intent: originalIntent, targetFiles } }
          }
        ]
      }
    };
  }
  const success = editResult?.success !== false;
  const results = Array.isArray(editResult?.results) ? editResult.results.map((entry: any) => ({
    filePath: entry.filePath,
    success: entry.applied ?? entry.success ?? false,
    error: entry.error
  })) : undefined;

  const message = success ? undefined : (editResult?.message ?? "Batch apply failed.");
  const impactReports = success && includeImpact
    ? await collectBatchImpactReports(context, runTool, normalizedByFile, Math.max(0, batchImpactLimit))
    : [];
  const guidance = success
    ? {
        message: "Batch changes successfully applied.",
        suggestedActions: [
          {
            id: "manage.test",
            priority: 1,
            description: "Run tests for impacted areas.",
            rationale: "Validate behavior after batch changes.",
            toolCall: { tool: "manage", args: { command: "test" } }
          }
        ]
      }
    : {
        message: message ?? "Batch apply failed.",
        suggestedActions: [
          {
            id: "change.retry",
            priority: 1,
            description: "Retry batch change.",
            rationale: "Retry after addressing apply failures.",
            toolCall: { tool: "change", args: { action: "retry", intent: originalIntent, targetFiles, edits: rawEdits } }
          }
        ]
      };

  return {
    success,
    message,
    operation: "apply",
    results,
    impactReports: impactReports.length > 0 ? impactReports : undefined,
    editResult,
    transactionId: editResult?.operation?.id ?? "",
    rollbackAvailable: success,
    guidance
  };
}

async function collectBatchImpactReports(
  context: OrchestrationContext,
  runTool: (context: OrchestrationContext, tool: string, args: any) => Promise<any>,
  normalizedByFile: Map<string, { edits: any[] }>,
  limit: number
): Promise<Array<{ filePath: string; preview?: any; error?: string }>> {
  const results: Array<{ filePath: string; preview?: any; error?: string }> = [];
  if (limit <= 0) return results;
  let count = 0;
  for (const [filePath, normalization] of normalizedByFile.entries()) {
    if (count >= limit) break;
    try {
      const preview = await runTool(context, 'impact_analyze', { target: filePath, edits: normalization.edits });
      results.push({ filePath, preview });
    } catch (error: any) {
      results.push({ filePath, error: error?.message ?? "impact_analyze failed" });
    }
    count += 1;
  }
  return results;
}

export async function executeV2BatchChange(
  args: {
    intent: ParsedIntent;
    context: OrchestrationContext;
    rawEdits: any[];
    targetFiles: string[];
    dryRun: boolean;
    v2Mode: string;
  },
  getEditResolver: () => any,
  getEditCoordinator: () => any
): Promise<any> {
  const { intent, rawEdits, targetFiles, dryRun, v2Mode } = args;
  const resolver = getEditResolver();
  const coordinator = getEditCoordinator();

  const fallbackTarget = targetFiles.length === 1 ? targetFiles[0] : undefined;
  const mapped = mapEditsToFiles({
    targetFiles,
    rawEdits,
    fallbackTarget,
    extractEditFilePath: (edit: any) => {
      const candidate = edit?.filePath ?? edit?.path;
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
      const targetCandidate = edit?.target;
      if (isLikelyFilePath(targetCandidate)) {
        return targetCandidate.trim();
      }
      return undefined;
    }
  });

  if (mapped.error || !mapped.fileEdits) {
    return {
      success: false,
      message: mapped.error?.message ?? "Batch mapping failed.",
      errorCode: mapped.error?.errorCode
    };
  }

  const allResolved: any[] = [];
  for (const [filePath, edits] of mapped.fileEdits.entries()) {
    const res = await resolver.resolveAll(filePath, edits, { smartMatch: ConfigurationManager.getLayer3SmartMatchEnabled() });
    if (res.success && res.resolvedEdits) {
      allResolved.push(...res.resolvedEdits.map((r: any) => ({ ...r, filePath })));
    }
  }

  if (v2Mode === 'dryrun') return { success: true, dryRun: true, resolvedEdits: allResolved };

  const applyResult = await coordinator.applyBatchResolvedEdits(
    allResolved.map(r => ({ filePath: r.filePath, resolvedEdits: [r] })),
    dryRun
  );

  return {
    success: applyResult.success,
    dryRun,
    message: applyResult.message,
    changedFiles: Array.from(new Set(allResolved.map(r => r.filePath)))
  };
}
