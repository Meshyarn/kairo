import path from "path";
import type { IFileSystem } from "../../platform/FileSystem.js";
import type { ProjectIndex, FileIndexEntry } from "../ProjectIndex.js";

export function resolveStatConcurrency(statConcurrency: number | undefined): number {
  const optionValue = typeof statConcurrency === "number" ? statConcurrency : undefined;
  const envValue = Number(process.env.KAIRO_INDEX_STAT_CONCURRENCY ?? "");
  const candidate = Number.isFinite(optionValue) && optionValue! > 0
    ? optionValue!
    : (Number.isFinite(envValue) && envValue > 0 ? envValue : 32);
  return Math.max(4, Math.min(128, Math.floor(candidate)));
}

export async function batchShouldReindex(args: {
  files: string[];
  stopped: () => boolean;
  resolveStatConcurrency: () => number;
  shouldReindex: (filePath: string) => Promise<boolean>;
}): Promise<string[]> {
  const { files, stopped, resolveStatConcurrency, shouldReindex } = args;
  const concurrency = resolveStatConcurrency();
  const results: string[] = [];
  let index = 0;

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
    while (!stopped()) {
      const file = files[index];
      index += 1;
      if (!file) break;
      if (await shouldReindex(file)) {
        results.push(file);
      }
    }
  });

  await Promise.all(workers);
  return results;
}

export async function shouldReindex(args: {
  filePath: string;
  currentIndex: ProjectIndex | null;
  fileSystem: IFileSystem;
}): Promise<boolean> {
  const { filePath, currentIndex, fileSystem } = args;
  if (!currentIndex) return true;

  const normalized = path.resolve(filePath);
  let entry: FileIndexEntry | undefined = currentIndex.files[normalized];
  if (!entry) {
    try {
      const resolved = await fileSystem.realpath(normalized);
      entry = currentIndex.files[resolved];
    } catch {
      entry = undefined;
    }
  }
  if (!entry) return true;

  try {
    const stat = await fileSystem.stat(filePath);
    return stat.mtime > entry.mtime;
  } catch {
    return true;
  }
}
