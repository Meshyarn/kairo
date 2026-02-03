import path from "path";
import type { SymbolIndex } from "../../ast/SymbolIndex.js";
import { PathManager } from "../../utils/PathManager.js";

export function shouldIgnorePath(args: {
  rootPath: string;
  absolutePath: string;
  symbolIndex: SymbolIndex;
  isWithinRoot: (absolutePath: string) => boolean;
}): boolean {
  const { rootPath, absolutePath, symbolIndex, isWithinRoot } = args;
  if (!isWithinRoot(absolutePath)) return true;
  const relative = path.relative(rootPath, absolutePath);

  const normalized = relative.split(path.sep).join("/");
  const ignoredRoots = new Set([".mcp", ".kairo", ".kairo-index"]);
  const baseDir = PathManager.getBaseDir()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .replace(/^\.\//, "");
  if (baseDir && !path.isAbsolute(baseDir)) {
    const root = baseDir.split("/")[0];
    if (root) {
      ignoredRoots.add(root);
    }
  }
  if (Array.from(ignoredRoots).some(root => normalized === root || normalized.startsWith(`${root}/`))) {
    return true;
  }

  return symbolIndex.shouldIgnore(relative);
}
