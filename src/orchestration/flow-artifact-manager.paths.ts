import path from "path";
import type { ArtifactId, ArtifactType } from "../types/flow-artifacts.js";
import type { FlowArtifactManagerState } from "./flow-artifact-manager.types.js";

export function toRelativePersistPath(state: FlowArtifactManagerState, filePath: string): string {
  return path.relative(state.persistPath, filePath);
}

export function toAbsolutePersistPath(state: FlowArtifactManagerState, relativePath: string): string {
  return path.join(state.persistPath, relativePath);
}

export async function resolvePersistPath(
  state: FlowArtifactManagerState,
  id: ArtifactId,
  type?: ArtifactType,
  ensureDir?: boolean
): Promise<string> {
  const folder = type ? `${type}s` : "";
  const basePath = folder ? path.join(state.persistPath, folder) : state.persistPath;
  if (ensureDir) {
    await state.fileSystem.createDir(basePath);
  }
  const candidate = path.join(basePath, `${id}.json`);
  if (type || ensureDir) {
    return candidate;
  }
  const types: ArtifactType[] = ["research", "analysis", "style", "draft", "review", "graph", "schema", "evidence"];
  for (const entryType of types) {
    const entryPath = path.join(state.persistPath, `${entryType}s`, `${id}.json`);
    if (await state.fileSystem.exists(entryPath)) {
      return entryPath;
    }
  }
  return candidate;
}

export async function safeReadDirEntries(
  state: FlowArtifactManagerState,
  dirPath: string
): Promise<Array<{ name: string; isFile: boolean; isDirectory: boolean }>> {
  try {
    const entries = await state.fileSystem.readDir(dirPath);
    const results: Array<{ name: string; isFile: boolean; isDirectory: boolean }> = [];
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      try {
        const stat = await state.fileSystem.stat(fullPath);
        const isDirectory = stat.isDirectory();
        results.push({ name: entry, isFile: !isDirectory, isDirectory });
      } catch {
        continue;
      }
    }
    return results;
  } catch {
    return [];
  }
}
