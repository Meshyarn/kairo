import * as path from "path";
import { PatchStore } from "../../engine/PatchStore.js";
import { PathManager } from "../../utils/PathManager.js";
import type { HandlerContext } from "../HandlerContext.js";
import type { ManageHandlerDeps } from "./ManageHandlerUtils.js";

const copyFile = async (context: HandlerContext, sourcePath: string, targetPath: string): Promise<void> => {
  const content = await context.fileSystem.readFile(sourcePath);
  await context.fileSystem.writeFile(targetPath, content);
};

export const handleExport = async (deps: ManageHandlerDeps, args: any) => {
  const context = deps.context;
  const targetType = args?.targetType ?? "artifact";
  const target = args?.target;
  const format = args?.format ?? "both";
  if (!target) {
    return { success: false, output: "Missing target." };
  }
  if (targetType === "artifact") {
    const artifact = context.flowArtifactManager.get(target);
    if (!artifact) {
      return { success: false, output: "Artifact not found." };
    }
    const filePath = await context.flowArtifactManager.persist(target, artifact);
    return {
      success: true,
      output: "Artifact exported.",
      path: filePath
    };
  }

  const patchStore = new PatchStore();
  let patchRef = target;
  if (targetType === "transaction") {
    const transactions = context.indexDatabase.listTransactions({ status: "committed" });
    const entry = transactions.find(item => item.id === target);
    patchRef = entry?.patchRef ?? "";
  }
  if (!patchRef) {
    return { success: false, output: "Patch not found." };
  }
  const manifest = await patchStore.loadManifest(patchRef);
  if (!manifest) {
    return { success: false, output: "Patch manifest not found." };
  }
  const exportDir = path.join(PathManager.getHistoryDir(), "exports");
  await context.fileSystem.createDir(exportDir);
  const filesToCopy: string[] = [];
  const manifestPath = patchStore.resolveManifestPath(patchRef);
  filesToCopy.push(manifestPath);
  if ((format === "unified_diff" || format === "both") && manifest.diffPath) {
    filesToCopy.push(patchStore.resolvePayloadPath(manifest.diffPath));
  }
  if ((format === "structured_edits" || format === "both") && manifest.editsPath) {
    filesToCopy.push(patchStore.resolvePayloadPath(manifest.editsPath));
  }
  const exportedPaths: string[] = [];
  for (const filePath of filesToCopy) {
    const targetPath = path.join(exportDir, path.basename(filePath));
    await copyFile(context, filePath, targetPath);
    exportedPaths.push(targetPath);
  }
  return {
    success: true,
    output: "Patch exported.",
    paths: exportedPaths,
    format
  };
};

export const handleImport = async (deps: ManageHandlerDeps, args: any) => {
  const context = deps.context;
  const target = args?.target;
  if (!target) {
    return { success: false, output: "Missing artifact file path." };
  }
  const allowExternal = args?.allowExternal === true
    || process.env.KAIRO_MANAGE_IMPORT_ALLOW_EXTERNAL === "true";
  let resolvedPath: string;
  try {
    resolvedPath = allowExternal
      ? (path.isAbsolute(target) ? target : path.resolve(context.rootPath, target))
      : deps.resolveAbsolutePath(target);
  } catch (error) {
    return {
      success: false,
      output: `Invalid artifact path: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (!allowExternal && !deps.isWithinKairoDir(resolvedPath)) {
    return {
      success: false,
      output: "Import is restricted to the Kairo data directory. Set KAIRO_MANAGE_IMPORT_ALLOW_EXTERNAL=true to override."
    };
  }
  const artifact = await context.flowArtifactManager.importFromPath(resolvedPath);
  return {
    success: Boolean(artifact),
    output: artifact ? "Artifact imported." : "Artifact import failed.",
    artifact
  };
};
