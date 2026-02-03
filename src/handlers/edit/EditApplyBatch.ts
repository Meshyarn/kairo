import type { EditApplyDeps, EditOperation } from "./EditApplyTypes.js";
import { AuditLog } from "../../utils/AuditLog.js";

export async function applyAtomicBatchReplace(args: {
  deps: EditApplyDeps;
  applyMode: "atomic" | "partial";
  createOps: Array<{ filePath: string; absPath: string; content: string }>;
  deleteOps: Array<{ filePath: string; absPath: string; confirmationHash?: any }>;
  replaceEditsByFile: Map<string, any[]>;
  stableOps: EditOperation[];
  ordering: "stable" | "creates_first";
  diffMode?: any;
  preflightMap: Map<string, any>;
  overrideTrace?: any;
  overrideDecision?: any;
  overrideTargets: string[];
}): Promise<any | null> {
  const { deps, applyMode, createOps, deleteOps, replaceEditsByFile, stableOps, ordering, diffMode, preflightMap, overrideTrace, overrideDecision, overrideTargets } = args;
  if (applyMode !== "atomic" || createOps.length > 0 || deleteOps.length > 0 || replaceEditsByFile.size <= 1) {
    return null;
  }

  const orderedReplaceFiles = ordering === "stable"
    ? Array.from(new Set(stableOps.filter((op) => op.operation === "replace").map((op) => op.filePath)))
    : Array.from(replaceEditsByFile.keys());
  const batch = orderedReplaceFiles.map((filePath) => ({
    filePath: deps.resolveAbsolutePath(filePath),
    edits: replaceEditsByFile.get(filePath) ?? []
  }));
  const batchResult = await deps.context.editCoordinator.applyBatchEdits(
    batch,
    false,
    diffMode ? { diffMode } : undefined
  );
  if (!batchResult?.success) {
    const errorMessage = batchResult?.message ?? "Batch apply failed.";
    const errorCode = batchResult?.errorCode ?? "BATCH_APPLY_FAILED";
    const failedResults = orderedReplaceFiles.map((filePath) => ({
      filePath,
      operation: "replace",
      applied: false,
      status: "failed",
      errorCode,
      message: errorMessage,
      error: errorMessage
    }));
    const response = {
      success: false,
      status: "failed",
      message: errorMessage,
      errorCode,
      results: failedResults,
      summary: summarize(failedResults)
    };
    if (overrideTrace) {
      (response as any).overrideTrace = overrideTrace;
    }
    if (overrideDecision) {
      void AuditLog.append({
        pillar: "edit_apply",
        operation: "apply",
        decision: overrideDecision.decision,
        actor: overrideDecision.approval?.approvedBy,
        reason: overrideDecision.approval?.reason,
        ticket: overrideDecision.approval?.ticket,
        scope: overrideDecision.scope,
        requested: overrideDecision.requestedAllow,
        effective: overrideDecision.effectiveAllow,
        targetFiles: overrideTargets,
        result: {
          success: false,
          status: "failed",
          errorCode
        }
      });
    }
    return response;
  }
  const results = orderedReplaceFiles.map((filePath) => {
    const preflight = preflightMap.get(`${filePath}::replace`);
    return {
      filePath,
      operation: "replace",
      applied: true,
      status: "applied",
      diff: preflight?.diff
    };
  });
  for (const filePath of orderedReplaceFiles) {
    const absPath = deps.resolveAbsolutePath(filePath);
    deps.context.indexStateManager?.markDirty(filePath);
    deps.context.incrementalIndexer?.enqueuePaths(absPath, "high");
    deps.context.cacheInvalidationHub?.onEvent({ type: "file_changed", absPath });
  }
  const updated = await deps.collectUpdatedFileStates(orderedReplaceFiles);
  const response = {
    success: true,
    status: "success",
    results,
    summary: summarize(results),
    updatedFileStates: Object.keys(updated).length > 0 ? updated : undefined
  };
  if (overrideTrace) {
    (response as any).overrideTrace = overrideTrace;
  }
  if (overrideDecision) {
    void AuditLog.append({
      pillar: "edit_apply",
      operation: "apply",
      decision: overrideDecision.decision,
      actor: overrideDecision.approval?.approvedBy,
      reason: overrideDecision.approval?.reason,
      ticket: overrideDecision.approval?.ticket,
      scope: overrideDecision.scope,
      requested: overrideDecision.requestedAllow,
      effective: overrideDecision.effectiveAllow,
      targetFiles: overrideTargets,
      result: {
        success: true,
        status: "success"
      }
    });
  }
  return response;
}

function summarize(entries: any[]) {
  const summary = { planned: entries.length, applied: 0, failed: 0, blocked: 0, confirmationRequired: 0 };
  for (const entry of entries) {
    switch (entry.status) {
      case "applied":
        summary.applied += 1;
        break;
      case "blocked":
        summary.blocked += 1;
        break;
      case "confirmation_required":
        summary.confirmationRequired += 1;
        break;
      case "failed":
        summary.failed += 1;
        break;
      default:
        break;
    }
  }
  return summary;
}
