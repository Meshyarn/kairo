import path from "path";
import { PathManager } from "../utils/PathManager.js";

export const DEFAULT_IGNORE_DIRS_BASE = [".git", "node_modules", ".mcp", ".kairo", ".kairo-index", "dist", "coverage"];
export const DEFAULT_EXCLUDE_PATTERNS = ["dist/**", "coverage/**"];
export const DEFAULT_MAX_FILES = 20000;

export function getDefaultIgnoreDirs(): string[] {
    const dirs = new Set(DEFAULT_IGNORE_DIRS_BASE);
    const baseDir = PathManager.getBaseDir()
        .replace(/\\/g, "/")
        .replace(/\/+$/, "")
        .replace(/^\.\//, "");
    if (baseDir && !path.isAbsolute(baseDir)) {
        const root = baseDir.split("/")[0];
        if (root) dirs.add(root);
    }
    return Array.from(dirs);
}
