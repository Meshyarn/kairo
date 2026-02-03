import type { HandlerContext } from "../HandlerContext.js";

type EditCoordinatorDeps = {
  context: HandlerContext;
  resolveRelativePath: (inputPath: string) => string;
  resolveAbsolutePath: (inputPath: string) => string;
  normalizeEditPayload: (edit: any) => any;
  normalizeFileVersions: (raw: any) => Map<string, { expectedVersion?: number; expectedHash?: string }>;
  findFileVersionMismatches: (
    operationsByFile: Map<string, Set<string>>,
    fileVersions: Map<string, { expectedVersion?: number; expectedHash?: string }>
  ) => Promise<Array<{ filePath: string; current?: { version: number; contentHash: string }; reason: string }>>;
  buildFileVersionMismatchResponse: (
    mismatches: Array<{ filePath: string; current?: { version: number; contentHash: string } }>,
    operationsByFile?: Map<string, Set<string>>
  ) => any;
  collectUpdatedFileStates: (paths: string[]) => Promise<Record<string, { newVersion: number; newHash: string }>>;
};

export async function executeEditCoordinator(args: any, deps: EditCoordinatorDeps) {
  const edits = Array.isArray(args?.edits) ? args.edits : [];
  const dryRun = Boolean(args?.dryRun);
  const diffMode = args?.diffMode ?? args?.options?.diffMode;
  const skipImpactPreview = args?.options?.skipImpactPreview;
  const options = diffMode || skipImpactPreview !== undefined
    ? {
      diffMode,
      skipImpactPreview: skipImpactPreview === true
    }
    : undefined;

  const targetPath = args?.filePath ?? args?.path ?? args?.target;
  const fileVersions = deps.normalizeFileVersions(args?.fileVersions);
  if (targetPath) {
    const relPath = deps.resolveRelativePath(targetPath);
    const absPath = deps.resolveAbsolutePath(targetPath);
    const normalized = edits.map((edit: any) => deps.normalizeEditPayload(edit));
    const operationsByFile = new Map<string, Set<string>>();
    operationsByFile.set(relPath, new Set(edits.map((edit: any) => edit?.operation ?? "replace")));
    if (fileVersions.size > 0) {
      const mismatches = await deps.findFileVersionMismatches(operationsByFile, fileVersions);
      if (mismatches.length > 0) {
        return deps.buildFileVersionMismatchResponse(mismatches, operationsByFile);
      }
    }
    const result = await deps.context.editCoordinator.applyEdits(absPath, normalized, dryRun, options);
    if (!result) {
      return { success: false, message: "Edit failed." };
    }
    if (result.success && !dryRun) {
      const updated = await deps.collectUpdatedFileStates([relPath]);
      deps.context.cacheInvalidationHub?.onEvent({ type: "file_changed", absPath });
      return {
        ...result,
        updatedFileStates: Object.keys(updated).length > 0 ? updated : undefined
      };
    }
    return result;
  }

  const grouped = new Map<string, any[]>();
  const operationsByFile = new Map<string, Set<string>>();
  for (const edit of edits) {
    if (!edit?.filePath) continue;
    const relPath = deps.resolveRelativePath(edit.filePath);
    const list = grouped.get(relPath) ?? [];
    list.push(deps.normalizeEditPayload(edit));
    grouped.set(relPath, list);
    const operations = operationsByFile.get(relPath) ?? new Set<string>();
    operations.add(edit?.operation ?? "replace");
    operationsByFile.set(relPath, operations);
  }

  if (grouped.size === 0) {
    return { success: false, message: "filePath is required for edit_transaction." };
  }

  if (fileVersions.size > 0) {
    const mismatches = await deps.findFileVersionMismatches(operationsByFile, fileVersions);
    if (mismatches.length > 0) {
      return deps.buildFileVersionMismatchResponse(mismatches, operationsByFile);
    }
  }

  const batch = Array.from(grouped.entries()).map(([relPath, payload]) => ({
    filePath: deps.resolveAbsolutePath(relPath),
    edits: payload
  }));
  const result = await deps.context.editCoordinator.applyBatchEdits(batch, dryRun, options);
  if (!result) {
    return { success: false, message: "Edit failed." };
  }
  if (result.success && !dryRun) {
    const updated = await deps.collectUpdatedFileStates(Array.from(grouped.keys()));
    for (const relPath of grouped.keys()) {
      const absPath = deps.resolveAbsolutePath(relPath);
      deps.context.cacheInvalidationHub?.onEvent({ type: "file_changed", absPath });
    }
    return {
      ...result,
      updatedFileStates: Object.keys(updated).length > 0 ? updated : undefined
    };
  }
  return result;
}
