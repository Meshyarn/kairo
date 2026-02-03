import type { HandlerContext } from "../HandlerContext.js";

export function supportsGetVersion(context: HandlerContext): boolean {
  return typeof (context as any)?.fileVersionManager?.getVersion === "function";
}

export function supportsIncrementVersion(context: HandlerContext): boolean {
  return typeof (context as any)?.fileVersionManager?.incrementVersion === "function";
}

export async function readExists(context: HandlerContext, relPath: string): Promise<boolean> {
  const fileSystem = (context as any)?.fileSystem;
  if (fileSystem && typeof fileSystem.exists === "function") {
    return Boolean(await fileSystem.exists(relPath).catch(() => false));
  }
  if (fileSystem && typeof fileSystem.stat === "function") {
    try {
      await fileSystem.stat(relPath);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export async function getCurrentFileState(
  context: HandlerContext,
  absPath: string,
  contentHint?: string
): Promise<{ newVersion: number; newHash: string } | undefined> {
  if (supportsGetVersion(context)) {
    const versionInfo = await (context as any).fileVersionManager.getVersion(absPath);
    return { newVersion: versionInfo.version, newHash: versionInfo.contentHash };
  }
  if (supportsIncrementVersion(context) && typeof contentHint === "string") {
    const versionInfo = (context as any).fileVersionManager.incrementVersion(absPath, contentHint);
    if (!versionInfo || typeof versionInfo.version !== "number" || typeof versionInfo.contentHash !== "string") {
      return undefined;
    }
    return { newVersion: versionInfo.version, newHash: versionInfo.contentHash };
  }
  return undefined;
}

export function normalizeFileVersions(
  resolveRelativePath: (inputPath: string) => string,
  raw: any
): Map<string, { expectedVersion?: number; expectedHash?: string }> {
  const normalized = new Map<string, { expectedVersion?: number; expectedHash?: string }>();
  if (!raw || typeof raw !== "object") {
    return normalized;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!key) continue;
    const relPath = resolveRelativePath(key);
    if (!relPath) continue;
    const expectedVersion = typeof (value as any)?.expectedVersion === "number" ? (value as any).expectedVersion : undefined;
    const expectedHash = typeof (value as any)?.expectedHash === "string" ? (value as any).expectedHash : undefined;
    if (expectedVersion === undefined && expectedHash === undefined) continue;
    normalized.set(relPath, { expectedVersion, expectedHash });
  }
  return normalized;
}

export async function collectUpdatedFileStates(
  context: HandlerContext,
  resolveAbsolutePath: (inputPath: string) => string,
  paths: string[],
  readExistsFn: (context: HandlerContext, relPath: string) => Promise<boolean>
): Promise<Record<string, { newVersion: number; newHash: string }>> {
  const updated: Record<string, { newVersion: number; newHash: string }> = {};
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  for (const relPath of uniquePaths) {
    const exists = await readExistsFn(context, relPath);
    if (!exists) continue;
    const absPath = resolveAbsolutePath(relPath);
    const state = await getCurrentFileState(context, absPath);
    if (!state) continue;
    updated[relPath] = state;
  }
  return updated;
}

export async function findFileVersionMismatches(
  context: HandlerContext,
  resolveAbsolutePath: (inputPath: string) => string,
  operationsByFile: Map<string, Set<string>>,
  fileVersions: Map<string, { expectedVersion?: number; expectedHash?: string }>
): Promise<Array<{ filePath: string; current?: { version: number; contentHash: string }; reason: string }>> {
  const mismatches: Array<{ filePath: string; current?: { version: number; contentHash: string }; reason: string }> = [];
  if (fileVersions.size === 0) return mismatches;
  if (!supportsGetVersion(context)) return mismatches;
  for (const [filePath, expected] of fileVersions.entries()) {
    if (!operationsByFile.has(filePath)) continue;
    const operations = operationsByFile.get(filePath) ?? new Set();
    const absPath = resolveAbsolutePath(filePath);
    let current: any;
    try {
      current = await (context as any).fileVersionManager.getVersion(absPath);
    } catch {
      if (operations.has("create")) {
        continue;
      }
      mismatches.push({ filePath, reason: "missing_file" });
      continue;
    }
    if (expected.expectedHash !== undefined && current.contentHash !== expected.expectedHash) {
      mismatches.push({ filePath, current: { version: current.version, contentHash: current.contentHash }, reason: "hash_mismatch" });
      continue;
    }
    if (expected.expectedVersion !== undefined && current.version !== expected.expectedVersion) {
      mismatches.push({ filePath, current: { version: current.version, contentHash: current.contentHash }, reason: "version_mismatch" });
    }
  }
  return mismatches;
}

export function buildFileVersionMismatchResponse(
  mismatches: Array<{ filePath: string; current?: { version: number; contentHash: string } }>,
  operationsByFile?: Map<string, Set<string>>
) {
  const updatedFileStates: Record<string, { newVersion: number; newHash: string }> = {};
  for (const mismatch of mismatches) {
    if (mismatch.current) {
      updatedFileStates[mismatch.filePath] = {
        newVersion: mismatch.current.version,
        newHash: mismatch.current.contentHash
      };
    }
  }
  return {
    success: false,
    status: "blocked",
    errorCode: "FILE_VERSION_MISMATCH",
    message: "File version mismatch detected. Re-read the file(s) and retry the edit.",
    results: mismatches.map((mismatch) => ({
      filePath: mismatch.filePath,
      operation: operationsByFile?.get(mismatch.filePath)?.values().next().value ?? "replace",
      applied: false,
      status: "blocked",
      error: "FILE_VERSION_MISMATCH",
      errorCode: "FILE_VERSION_MISMATCH",
      nextActionHint: { suggestReRead: true }
    })),
    updatedFileStates: Object.keys(updatedFileStates).length > 0 ? updatedFileStates : undefined
  };
}
