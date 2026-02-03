import type { HandlerContext } from "../HandlerContext.js";

type EditFileDeps = {
  context: HandlerContext;
  resolveRelativePath: (inputPath: string) => string;
  resolveAbsolutePath: (inputPath: string) => string;
  normalizeEditPayload: (edit: any) => any;
};

export async function editFileRaw(args: any, deps: EditFileDeps) {
  const filePath = deps.resolveRelativePath(args.filePath);
  const absPath = deps.resolveAbsolutePath(args.filePath);
  const edits = Array.isArray(args?.edits) ? args.edits : [];
  const mapped = edits.map((edit: any) => deps.normalizeEditPayload(edit));
  const result = await deps.context.editCoordinator.applyEdits(
    absPath,
    mapped,
    Boolean(args?.dryRun)
  );
  if (result.success) {
    return result;
  }
  return {
    ...result,
    filePath,
    details: result.details
  };
}

export async function executeWriteFile(args: any, deps: EditFileDeps) {
  const filePath = deps.resolveRelativePath(args.filePath);
  const absPath = deps.resolveAbsolutePath(args.filePath);
  const content = args?.content ?? "";
  await deps.context.fileSystem.writeFile(absPath, content);
  deps.context.fileVersionManager.incrementVersion(absPath, content);
  deps.context.indexStateManager?.markDirty(filePath);
  deps.context.incrementalIndexer?.enqueuePaths(absPath, "high");
  deps.context.cacheInvalidationHub?.onEvent({ type: "file_changed", absPath });
  return { success: true, filePath };
}
