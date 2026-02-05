import * as path from "path";
import * as crypto from "crypto";
import type { BatchOperation, FileOperation } from "../../types.js";
import { AuditLog } from "../../utils/AuditLog.js";
import type { EditApplyDeps, EditOperation } from "./EditApplyTypes.js";

export async function applyEditOperations(args: {
  deps: EditApplyDeps;
  applyMode: "atomic" | "partial";
  diffMode?: any;
  ordering: "stable" | "creates_first";
  createMissingDirectories: boolean;
  createOps: Array<{ filePath: string; absPath: string; content: string }>;
  deleteOps: Array<{ filePath: string; absPath: string; confirmationHash?: any }>;
  replaceEditsByFile: Map<string, any[]>;
  stableOps: EditOperation[];
  preflightMap: Map<string, any>;
  overrideTrace?: any;
  overrideDecision?: any;
  overrideTargets: string[];
}): Promise<any> {
  const { deps, applyMode, diffMode, ordering, createMissingDirectories, createOps, deleteOps, replaceEditsByFile, stableOps, preflightMap, overrideTrace, overrideDecision, overrideTargets } = args;

  const updatedFileStates: Record<string, { newVersion: number; newHash: string }> = {};
  const appliedFiles = new Set<string>();
  const appliedDeletes = new Set<string>();
  const results: any[] = [];
  const postApplyActions: Array<{ type: "write" | "delete"; filePath: string; absPath: string }> = [];
  const fileOperations: FileOperation[] = [];
  const recordFileOperation = (action: "create" | "delete", filePath: string, content?: string) => {
    fileOperations.push({
      type: "file",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      description: "edit_apply file operation",
      filePath,
      action,
      content
    });
  };

  const snapshot = new Map<string, { exists: boolean; content?: string }>();
  if (applyMode === "atomic") {
    const affected = new Set<string>();
    for (const op of [...createOps, ...deleteOps]) {
      affected.add(op.filePath);
    }
    for (const filePath of replaceEditsByFile.keys()) {
      affected.add(filePath);
    }
    for (const filePath of affected) {
      const absPath = deps.resolveAbsolutePath(filePath);
      const exists = await deps.readExists(filePath);
      if (exists) {
        try {
          const content = await deps.context.fileSystem.readFile(filePath);
          snapshot.set(filePath, { exists: true, content });
        } catch {
          snapshot.set(filePath, { exists: true, content: "" });
        }
      } else {
        snapshot.set(filePath, { exists: false });
      }
    }
  }

  const applyCreate = async (create: { filePath: string; absPath: string; content?: string }) => {
    if (createMissingDirectories) {
      const dir = path.dirname(create.absPath);
      await deps.context.fileSystem.createDir(dir);
    }
    await deps.context.fileSystem.writeFile(create.absPath, create.content ?? "");
    appliedFiles.add(create.filePath);
    results.push({ filePath: create.filePath, operation: "create", applied: true, status: "applied" });
    postApplyActions.push({ type: "write", filePath: create.filePath, absPath: create.absPath });
    recordFileOperation("create", create.filePath, create.content ?? "");
  };

  const applyReplace = async (filePath: string, editsForFile: any[]) => {
    const absPath = deps.resolveAbsolutePath(filePath);
    const result = await deps.context.editCoordinator.applyEdits(
      absPath,
      editsForFile,
      false,
      diffMode ? { diffMode } : undefined
    );
    if (!result?.success) {
      results.push({
        filePath,
        operation: "replace",
        applied: false,
        status: "failed",
        errorCode: result?.errorCode ?? "BATCH_APPLY_FAILED",
        message: result?.message ?? "Edit failed.",
        error: result?.message ?? "Edit failed."
      });
      return false;
    }
    appliedFiles.add(filePath);
    results.push({
      filePath,
      operation: "replace",
      applied: true,
      status: "applied",
      diff: result?.diff
    });
    postApplyActions.push({ type: "write", filePath, absPath });
    return true;
  };

  const applyDelete = async (del: { filePath: string; absPath: string }) => {
    const content = await deps.context.fileSystem.readFile(del.absPath);
    await deps.context.fileSystem.deleteFile(del.absPath);
    appliedDeletes.add(del.filePath);
    results.push({ filePath: del.filePath, operation: "delete", applied: true, status: "applied" });
    postApplyActions.push({ type: "delete", filePath: del.filePath, absPath: del.absPath });
    recordFileOperation("delete", del.filePath, content);
  };

  const rollback = async () => {
    for (const [filePath, state] of snapshot.entries()) {
      const absPath = deps.resolveAbsolutePath(filePath);
      if (state.exists) {
        const dir = path.dirname(absPath);
        await deps.context.fileSystem.createDir(dir);
        await deps.context.fileSystem.writeFile(absPath, state.content ?? "");
      } else if (await deps.readExists(filePath)) {
        await deps.context.fileSystem.deleteFile(absPath);
      }
    }
  };

  const ordered = ordering === "stable"
    ? stableOps
    : [
      ...createOps.map((op) => ({ operation: "create" as const, filePath: op.filePath, absPath: op.absPath, content: op.content })),
      ...Array.from(replaceEditsByFile.entries()).map(([filePath, editsForFile]) => ({
        operation: "replace" as const,
        filePath,
        absPath: deps.resolveAbsolutePath(filePath),
        edits: editsForFile
      })),
      ...deleteOps.map((op) => ({ operation: "delete" as const, filePath: op.filePath, absPath: op.absPath, confirmationHash: op.confirmationHash }))
    ];

  let applyFailed = false;
  const attemptedKeys = new Set<string>();
  for (const op of ordered) {
    const opKey = `${op.filePath}::${op.operation}`;
    attemptedKeys.add(opKey);
    if (applyMode === "partial") {
      const preflight = preflightMap.get(opKey);
      if (!preflight || preflight.status !== "dry_run_ok") {
        results.push({
          ...(preflight ?? {
            filePath: op.filePath,
            operation: op.operation,
            applied: false,
            status: "blocked",
            message: "Preflight blocked this operation."
          })
        });
        continue;
      }
    }
    if (op.operation === "create") {
      try {
        await applyCreate(op);
      } catch (error: any) {
        results.push({
          filePath: op.filePath,
          operation: "create",
          applied: false,
          status: "failed",
          errorCode: "BATCH_APPLY_FAILED",
          message: error?.message ?? "Create failed.",
          error: error?.message ?? "Create failed."
        });
        applyFailed = true;
      }
    } else if (op.operation === "replace") {
      const success = await applyReplace(op.filePath, op.edits ?? []);
      if (!success) applyFailed = true;
    } else if (op.operation === "delete") {
      try {
        await applyDelete(op);
      } catch (error: any) {
        results.push({
          filePath: op.filePath,
          operation: "delete",
          applied: false,
          status: "failed",
          errorCode: "BATCH_APPLY_FAILED",
          message: error?.message ?? "Delete failed.",
          error: error?.message ?? "Delete failed."
        });
        applyFailed = true;
      }
    }
    if (applyFailed && applyMode === "atomic") {
      break;
    }
  }

  if (applyFailed && applyMode === "atomic") {
    await rollback();
    for (const [key, entry] of preflightMap.entries()) {
      if (!attemptedKeys.has(key)) {
        results.push({
          ...entry,
          applied: false,
          status: "blocked",
          errorCode: entry.errorCode ?? "BATCH_APPLY_FAILED",
          message: entry.message ?? "Blocked due to atomic failure.",
          error: entry.message ?? "Blocked due to atomic failure."
        });
      }
    }
    const failedResults = results.map((entry) => ({
      ...entry,
      applied: false,
      status: entry.status === "failed" ? "failed" : "blocked",
      errorCode: entry.errorCode ?? "BATCH_APPLY_FAILED",
      message: entry.message ?? "Rolled back due to atomic failure.",
      error: entry.message ?? "Rolled back due to atomic failure."
    }));
    return {
      success: false,
      status: "failed",
      message: "Atomic apply failed; all changes rolled back.",
      errorCode: "BATCH_APPLY_FAILED",
      results: failedResults,
      summary: summarize(failedResults),
      ...(overrideTrace ? { overrideTrace } : {})
    };
  }

  for (const action of postApplyActions) {
    if (action.type === "write") {
      deps.context.indexStateManager?.markDirty(action.filePath);
      deps.context.incrementalIndexer?.enqueuePaths(action.absPath, "high");
      deps.context.cacheInvalidationHub?.onEvent({ type: "file_changed", absPath: action.absPath });
    } else {
      deps.context.indexStateManager?.markDirty(action.filePath);
      void deps.context.incrementalIndexer?.notifyDeletion(action.absPath);
      deps.context.cacheInvalidationHub?.onEvent({ type: "file_deleted", absPath: action.absPath });
    }
  }

  const appliedPaths = Array.from(appliedFiles.values());
  const updated = await deps.collectUpdatedFileStates(appliedPaths);
  Object.assign(updatedFileStates, updated);

  if (fileOperations.length > 0) {
    const batchOperation: BatchOperation = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      description: "edit_apply file operations",
      operations: fileOperations
    };
    await deps.context.historyEngine.pushOperation(batchOperation);
  }

  const summary = summarize(results);
  const success = applyMode === "partial"
    ? results.every((entry) => entry.status === "applied")
    : !applyFailed;
  const status = success
    ? "success"
    : (summary.applied > 0 ? "partial_success" : (summary.blocked > 0 || summary.confirmationRequired > 0 ? "blocked" : "failed"));

  const response = {
    success,
    status,
    results,
    summary,
    updatedFileStates: Object.keys(updatedFileStates).length > 0 ? updatedFileStates : undefined
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
        success,
        status,
        errorCode: (response as any).errorCode
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
