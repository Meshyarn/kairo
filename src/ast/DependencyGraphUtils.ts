import * as path from "path";
import type { IFileSystem } from "../platform/FileSystem.js";

export function detectMonorepo(rootPath: string, fileSystem: IFileSystem): boolean {
  const indicatorFiles = ["lerna.json", "pnpm-workspace.yaml", "turbo.json", "nx.json"];
  if (indicatorFiles.some(file => fileSystem.existsSync?.(path.join(rootPath, file)))) {
    return true;
  }

  const candidateDirs = ["packages", "apps", "services", "libs"];
  for (const dir of candidateDirs) {
    const rootDir = path.join(rootPath, dir);
    if (!fileSystem.existsSync?.(rootDir) || !fileSystem.statSync?.(rootDir)?.isDirectory()) continue;
    const subdirs = (fileSystem.readDirSync?.(rootDir) ?? []).filter(entry => {
      const full = path.join(rootDir, entry);
      try {
        return fileSystem.statSync?.(full)?.isDirectory() && fileSystem.existsSync?.(path.join(full, "package.json"));
      } catch {
        return false;
      }
    });
    if (subdirs.length > 0) {
      return true;
    }
  }
  return false;
}
