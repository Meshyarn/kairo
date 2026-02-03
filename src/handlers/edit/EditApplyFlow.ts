import { AuditLog } from "../../utils/AuditLog.js";
import {
  detectOverrideRequirementsForEditApply,
  evaluateOverride,
  type OverrideTrace
} from "../../utils/GuardrailsOverride.js";
import type { EditApplyDeps, EditOperation } from "./EditApplyTypes.js";
import { runPreflight } from "./EditApplyPreflight.js";
import { applyAtomicBatchReplace } from "./EditApplyBatch.js";
import { applyEditOperations } from "./EditApplyExecution.js";

export async function editCodeRaw(args: any, deps: EditApplyDeps) {
  const edits = Array.isArray(args?.edits) ? args.edits : [];
  if (edits.length === 0) {
    return { success: false, results: [], message: "No edits provided." };
  }

  const dryRun = Boolean(args?.dryRun);
  const diffMode = args?.diffMode;
  const createMissingDirectories = Boolean(args?.createMissingDirectories);
  const rawOptions = args?.options && typeof args.options === "object" ? args.options : {};
  const applyMode = rawOptions.applyMode === "partial" ? "partial" : "atomic";
  const deleteMode = rawOptions.deleteMode === "confirm" ? "confirm" : "forbid";
  const ordering = rawOptions.ordering === "stable" ? "stable" : "creates_first";
  const overrideTargets = edits
    .map((edit: any) => (edit?.filePath ? deps.resolveRelativePath(edit.filePath) : undefined))
    .filter(Boolean) as string[];
  const overrideDecision = evaluateOverride({
    override: args?.override,
    requiredOverrides: detectOverrideRequirementsForEditApply({ options: rawOptions, edits }),
    targetFiles: overrideTargets,
    pillar: "edit_apply"
  });
  let overrideTrace: OverrideTrace | undefined;
  if (overrideDecision) {
    const auditEventId = await AuditLog.append({
      pillar: "edit_apply",
      operation: "override_check",
      decision: overrideDecision.decision,
      actor: overrideDecision.approval?.approvedBy,
      reason: overrideDecision.approval?.reason,
      ticket: overrideDecision.approval?.ticket,
      scope: overrideDecision.scope,
      requested: overrideDecision.requestedAllow,
      effective: overrideDecision.effectiveAllow,
      targetFiles: overrideTargets,
      result: overrideDecision.errorCode
        ? { success: false, status: "blocked", errorCode: overrideDecision.errorCode }
        : undefined
    });
    overrideTrace = {
      auditEventId,
      decision: overrideDecision.decision,
      overridesUsed: overrideDecision.overridesUsed,
      expiresAt: overrideDecision.approval?.expiresAt
    };
    if (overrideDecision.errorCode) {
      return {
        success: false,
        status: "blocked",
        errorCode: overrideDecision.errorCode,
        blockedReason: overrideDecision.blockedReason,
        message: overrideDecision.message,
        overrideTrace,
        results: [],
        summary: { planned: 0, applied: 0, failed: 0, blocked: 1, confirmationRequired: 0 }
      };
    }
  }

  const operationsByFile = new Map<string, Set<string>>();
  const addOperation = (filePath: string, operation: string) => {
    const list = operationsByFile.get(filePath) ?? new Set<string>();
    list.add(operation);
    operationsByFile.set(filePath, list);
  };

  const createOps: Array<{ filePath: string; absPath: string; content: string }> = [];
  const deleteOps: Array<{ filePath: string; absPath: string; confirmationHash?: any }> = [];
  const replaceEditsByFile = new Map<string, any[]>();
  const stableOps: EditOperation[] = [];

  for (const edit of edits) {
    if (!edit?.filePath) continue;
    const operation = edit.operation ?? "replace";
    const filePath = deps.resolveRelativePath(edit.filePath);
    const absPath = deps.resolveAbsolutePath(filePath);
    addOperation(filePath, operation);
    if (operation === "create") {
      const content = edit.replacementString ?? "";
      createOps.push({ filePath, absPath, content });
      stableOps.push({ operation: "create", filePath, absPath, content });
      continue;
    }
    if (operation === "delete") {
      deleteOps.push({ filePath, absPath, confirmationHash: edit.confirmationHash });
      stableOps.push({ operation: "delete", filePath, absPath, confirmationHash: edit.confirmationHash });
      continue;
    }
    const fileEdits = replaceEditsByFile.get(filePath) ?? [];
    fileEdits.push(deps.normalizeEditPayload(edit));
    replaceEditsByFile.set(filePath, fileEdits);
    stableOps.push({ operation: "replace", filePath, absPath, edits: [deps.normalizeEditPayload(edit)] });
  }

  const fileVersions = deps.normalizeFileVersions(args?.fileVersions);
  if (fileVersions.size > 0) {
    const mismatches = await deps.findFileVersionMismatches(operationsByFile, fileVersions);
    if (mismatches.length > 0) {
      return deps.buildFileVersionMismatchResponse(mismatches, operationsByFile);
    }
  }

  const { preflightResults, preflightMap } = await runPreflight({
    deps,
    createOps,
    deleteOps,
    replaceEditsByFile,
    createMissingDirectories,
    deleteMode,
    diffMode
  });

  const summarize = (entries: any[]) => {
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
  };

  const anyStatus = (entries: any[], status: string) => entries.some((entry) => entry.status === status);
  const hasPreflightFailures = anyStatus(preflightResults, "failed") || anyStatus(preflightResults, "blocked") || anyStatus(preflightResults, "confirmation_required");
  if (dryRun || (applyMode === "atomic" && hasPreflightFailures)) {
    const summary = summarize(preflightResults);
    const blocked = anyStatus(preflightResults, "blocked") || anyStatus(preflightResults, "confirmation_required");
    const failed = anyStatus(preflightResults, "failed");
    const response = {
      success: !blocked && !failed,
      status: blocked ? "blocked" : (failed ? "failed" : "success"),
      message: blocked ? "Preflight blocked the apply request." : (failed ? "Preflight failed for one or more edits." : "Dry run completed."),
      results: preflightResults,
      summary
    };
    if (overrideTrace) {
      (response as any).overrideTrace = overrideTrace;
    }
    if (overrideDecision) {
      void AuditLog.append({
        pillar: "edit_apply",
        operation: dryRun ? "dry_run" : "apply",
        decision: overrideDecision.decision,
        actor: overrideDecision.approval?.approvedBy,
        reason: overrideDecision.approval?.reason,
        ticket: overrideDecision.approval?.ticket,
        scope: overrideDecision.scope,
        requested: overrideDecision.requestedAllow,
        effective: overrideDecision.effectiveAllow,
        targetFiles: overrideTargets,
        result: {
          success: response.success,
          status: response.status,
          errorCode: (response as any).errorCode
        }
      });
    }
    return response;
  }

  const batchResponse = await applyAtomicBatchReplace({
    deps,
    applyMode,
    createOps,
    deleteOps,
    replaceEditsByFile,
    stableOps,
    ordering,
    diffMode,
    preflightMap,
    overrideTrace,
    overrideDecision,
    overrideTargets
  });
  if (batchResponse) {
    return batchResponse;
  }

  return applyEditOperations({
    deps,
    applyMode,
    diffMode,
    ordering,
    createMissingDirectories,
    createOps,
    deleteOps,
    replaceEditsByFile,
    stableOps,
    preflightMap,
    overrideTrace,
    overrideDecision,
    overrideTargets
  });
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
