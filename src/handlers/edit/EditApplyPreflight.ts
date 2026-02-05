import * as path from "path";
import type { EditApplyDeps } from "./EditApplyTypes.js";

export async function runPreflight(args: {
  deps: EditApplyDeps;
  createOps: Array<{ filePath: string; absPath: string; content: string }>;
  deleteOps: Array<{ filePath: string; absPath: string; confirmationHash?: any }>;
  replaceEditsByFile: Map<string, any[]>;
  createMissingDirectories: boolean;
  deleteMode: "confirm" | "forbid";
  diffMode?: any;
}): Promise<{ preflightResults: any[]; preflightMap: Map<string, any> }> {
  const { deps, createOps, deleteOps, replaceEditsByFile, createMissingDirectories, deleteMode, diffMode } = args;
  const preflightResults: any[] = [];
  const preflightMap = new Map<string, any>();
  const recordPreflight = (entry: any) => {
    preflightResults.push(entry);
    preflightMap.set(`${entry.filePath}::${entry.operation}`, entry);
  };
  const ensureDirExists = async (dirPath: string) => {
    const exists = await deps.readExists(dirPath);
    if (exists) return true;
    return createMissingDirectories;
  };

  for (const create of createOps) {
    const exists = await deps.readExists(create.filePath);
    if (exists) {
      recordPreflight({
        filePath: create.filePath,
        operation: "create",
        applied: false,
        status: "failed",
        errorCode: "CREATE_ALREADY_EXISTS",
        message: "File already exists.",
        error: "File already exists."
      });
      continue;
    }
    const dirPath = path.dirname(create.absPath);
    const dirOk = await ensureDirExists(dirPath);
    if (!dirOk) {
      recordPreflight({
        filePath: create.filePath,
        operation: "create",
        applied: false,
        status: "failed",
        errorCode: "MISSING_PARENT_DIR",
        message: "Parent directory is missing.",
        error: "Parent directory is missing."
      });
      continue;
    }
    recordPreflight({
      filePath: create.filePath,
      operation: "create",
      applied: false,
      status: "dry_run_ok"
    });
  }

  for (const del of deleteOps) {
    if (deleteMode === "forbid") {
      recordPreflight({
        filePath: del.filePath,
        operation: "delete",
        applied: false,
        status: "blocked",
        errorCode: "DELETE_FORBIDDEN",
        message: "Delete is blocked by policy.",
        error: "Delete is blocked by policy."
      });
      continue;
    }
    const exists = await deps.readExists(del.filePath);
    if (!exists) {
      recordPreflight({
        filePath: del.filePath,
        operation: "delete",
        applied: false,
        status: "failed",
        errorCode: "MISSING_FILE",
        message: "File does not exist.",
        error: "File does not exist."
      });
      continue;
    }
    if (!del.confirmationHash) {
      recordPreflight({
        filePath: del.filePath,
        operation: "delete",
        applied: false,
        status: "confirmation_required",
        requiresConfirmation: true,
        errorCode: "DELETE_CONFIRMATION_REQUIRED",
        message: "Delete requires confirmation hash.",
        error: "Delete requires confirmation hash.",
        confirmationHint: {
          algorithm: "sha256",
          valueFormat: "hex",
          rationale: "Provide a hash of the current file content to confirm deletion."
        }
      });
      continue;
    }
    let content = "";
    try {
      content = await deps.context.fileSystem.readFile(del.filePath);
    } catch (error: any) {
      recordPreflight({
        filePath: del.filePath,
        operation: "delete",
        applied: false,
        status: "failed",
        errorCode: "MISSING_FILE",
        message: error?.message ?? "File does not exist.",
        error: error?.message ?? "File does not exist."
      });
      continue;
    }
    const expected = typeof del.confirmationHash === "string" ? del.confirmationHash : del.confirmationHash.value;
    const algo = typeof del.confirmationHash === "string" ? "sha256" : (del.confirmationHash.algorithm ?? "sha256");
    const hash = deps.computeHash(content, algo);
    if (hash !== expected) {
      recordPreflight({
        filePath: del.filePath,
        operation: "delete",
        applied: false,
        status: "failed",
        errorCode: "DELETE_HASH_MISMATCH",
        message: "Hash mismatch detected; deletion blocked.",
        error: "Hash mismatch detected; deletion blocked."
      });
      continue;
    }
    recordPreflight({
      filePath: del.filePath,
      operation: "delete",
      applied: false,
      status: "dry_run_ok"
    });
  }

  for (const [filePath, fileEdits] of replaceEditsByFile.entries()) {
    const exists = await deps.readExists(filePath);
    if (!exists) {
      recordPreflight({
        filePath,
        operation: "replace",
        applied: false,
        status: "failed",
        errorCode: "MISSING_FILE",
        message: "File does not exist.",
        error: "File does not exist."
      });
      continue;
    }
    const absPath = deps.resolveAbsolutePath(filePath);
    let previewResult: any;
    try {
      previewResult = await deps.context.editCoordinator.applyEdits(
        absPath,
        fileEdits,
        true,
        diffMode ? { diffMode } : undefined
      );
    } catch (error: any) {
      recordPreflight({
        filePath,
        operation: "replace",
        applied: false,
        status: "failed",
        errorCode: "BATCH_APPLY_FAILED",
        message: error?.message ?? "Edit failed.",
        error: error?.message ?? "Edit failed."
      });
      continue;
    }
    if (!previewResult?.success) {
      recordPreflight({
        filePath,
        operation: "replace",
        applied: false,
        status: "failed",
        errorCode: previewResult?.errorCode ?? "BATCH_APPLY_FAILED",
        message: previewResult?.message ?? "Edit failed.",
        error: previewResult?.message ?? "Edit failed."
      });
      continue;
    }
    recordPreflight({
      filePath,
      operation: "replace",
      applied: false,
      status: "dry_run_ok",
      diff: previewResult?.diff
    });
  }

  return { preflightResults, preflightMap };
}
