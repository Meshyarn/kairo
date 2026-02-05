import path from "path";
import { PathManager } from "./PathManager.js";
import type { IFileSystem } from "../platform/FileSystem.js";
import type { ContentSourceResolveError, ContentSourceResolveOptions, RepoRoot } from "./ContentSourceResolverTypes.js";

export function resolveAllowedRoots(
  options: ContentSourceResolveOptions,
  rootPath: string
): { roots: RepoRoot[] } | { error: ContentSourceResolveError } {
  const repoRegistry = options.repoRegistry;
  const repoScope = options.repoScope;

  if (!repoRegistry || !repoScope) {
    return {
      roots: [{ id: "workspace", rootPath, kind: "workspace" }]
    };
  }

  const roots: RepoRoot[] = [];
  if (repoScope.scope.mode === "default") {
    const repo = repoRegistry.getDefaultRepo();
    if (!repo) {
      return { error: buildErrorValue("CONTENT_SOURCE_INVALID", "Default repository is not configured.", "failure") };
    }
    roots.push({ id: repo.id, rootPath: repo.path, kind: "repo" });
  } else if (repoScope.scope.mode === "repos") {
    for (const repoId of repoScope.repoIds ?? []) {
      const repo = repoRegistry.getRepo(repoId);
      if (!repo) {
        return { error: buildErrorValue("CONTENT_SOURCE_INVALID", `Unknown repoId: ${repoId}`, "failure") };
      }
      roots.push({ id: repo.id, rootPath: repo.path, kind: "repo" });
    }
  } else {
    for (const repo of repoRegistry.getAllRepos()) {
      roots.push({ id: repo.id, rootPath: repo.path, kind: "repo" });
    }
  }

  if (repoScope.includeUnscoped) {
    roots.push({ id: "unscoped", rootPath, kind: "workspace" });
  }

  const deduped = new Map<string, RepoRoot>();
  for (const root of roots) {
    const normalized = path.resolve(root.rootPath);
    if (!deduped.has(normalized)) {
      deduped.set(normalized, { ...root, rootPath: normalized });
    }
  }

  return { roots: Array.from(deduped.values()) };
}

export async function resolveFileCandidate(argsPath: string, options: {
  rootPath: string;
  allowedRoots: RepoRoot[];
  tempDirs: string[];
  fileSystem: IFileSystem;
}): Promise<
  | { ok: true; absolutePath: string; workspacePath: string; isTemp: boolean }
  | { ok: false; error: ContentSourceResolveError }
> {
  const isAbs = path.isAbsolute(argsPath);
  const candidatePaths = new Set<string>();
  const normalizedPath = argsPath.replace(/\\/g, "/");

  if (isAbs) {
    candidatePaths.add(path.normalize(argsPath));
  } else {
    candidatePaths.add(path.resolve(options.rootPath, normalizedPath));
    for (const root of options.allowedRoots) {
      candidatePaths.add(path.resolve(root.rootPath, normalizedPath));
    }
  }

  const candidates = Array.from(candidatePaths.values());
  const evaluated: Array<{ absolutePath: string; workspacePath: string; isTemp: boolean }> = [];

  for (const candidate of candidates) {
    const absolutePath = path.resolve(candidate);
    const isTemp = options.tempDirs.some((dir) => isWithinPath(dir, absolutePath));

    if (!isTemp) {
      const matchingRoots = selectMatchingRoots(options.allowedRoots, absolutePath);
      if (matchingRoots === "none") {
        continue;
      }
      if (matchingRoots === "ambiguous") {
        return buildCandidateError("CONTENT_SOURCE_AMBIGUOUS", "contentSource file path is ambiguous across repos.", "failure");
      }
    }

    const workspacePath = toWorkspacePath(options.rootPath, absolutePath);
    if (workspacePath === null && !isTemp) {
      return buildCandidateError(
        "CONTENT_SOURCE_BLOCKED",
        "contentSource file is outside the workspace root.",
        "blocked",
        "content_source_out_of_scope"
      );
    }

    evaluated.push({
      absolutePath,
      workspacePath: workspacePath ?? absolutePath.replace(/\\/g, "/"),
      isTemp
    });
  }

  if (evaluated.length === 0) {
    return buildCandidateError(
      "CONTENT_SOURCE_BLOCKED",
      "contentSource file is outside the allowed repository scope.",
      "blocked",
      "content_source_out_of_scope"
    );
  }

  const existing: Array<{ absolutePath: string; workspacePath: string; isTemp: boolean }> = [];
  for (const candidate of evaluated) {
    if (await options.fileSystem.exists(candidate.absolutePath)) {
      existing.push(candidate);
    }
  }

  if (existing.length === 0) {
    return buildCandidateError(
      "CONTENT_SOURCE_NOT_FOUND",
      `contentSource file not found: ${evaluated[0].workspacePath}`,
      "failure",
      undefined,
      { tried: evaluated.map((item) => item.workspacePath) }
    );
  }

  if (existing.length > 1) {
    return buildCandidateError(
      "CONTENT_SOURCE_AMBIGUOUS",
      "contentSource file path matches multiple repositories. Specify repoScope/repoId or use workspace-relative path.",
      "failure",
      undefined,
      { matches: existing.map((item) => item.workspacePath) }
    );
  }

  return { ok: true, ...existing[0] };
}

export function resolveTempDirs(rootPath: string): string[] {
  const baseDir = PathManager.getBaseDir();
  const baseAbs = path.isAbsolute(baseDir) ? path.normalize(baseDir) : path.resolve(rootPath, baseDir);
  return [path.join(baseAbs, "tmp"), path.join(baseAbs, "temp")];
}

export function isInternalIgnoredPath(workspacePath: string, rootPath: string): boolean {
  const normalized = workspacePath.replace(/\\/g, "/");
  const baseDir = PathManager.getBaseDir();
  const baseAbs = path.isAbsolute(baseDir) ? path.normalize(baseDir) : path.resolve(rootPath, baseDir);
  const baseRel = toWorkspacePath(rootPath, baseAbs)?.replace(/\\/g, "/");
  const internalRoots = new Set([".mcp", ".kairo", ".kairo-index"]);
  if (baseRel) internalRoots.add(baseRel);

  for (const root of internalRoots) {
    if (normalized === root || normalized.startsWith(`${root}/`)) {
      if (root === baseRel || root === ".kairo" || root === ".mcp") {
        if (
          normalized === `${root}/tmp` ||
          normalized.startsWith(`${root}/tmp/`) ||
          normalized === `${root}/temp` ||
          normalized.startsWith(`${root}/temp/`)
        ) {
          return false;
        }
      }
      return true;
    }
  }
  return false;
}

function selectMatchingRoots(roots: RepoRoot[], absolutePath: string): "none" | "ambiguous" | RepoRoot {
  if (roots.length === 0) return "none";
  const matches = roots.filter((root) => isWithinPath(root.rootPath, absolutePath));
  if (matches.length === 0) return "none";
  matches.sort((a, b) => b.rootPath.length - a.rootPath.length);
  if (matches.length > 1 && matches[0].rootPath.length === matches[1].rootPath.length) {
    return "ambiguous";
  }
  return matches[0];
}

function toWorkspacePath(rootPath: string, absolutePath: string): string | null {
  const relative = path.relative(rootPath, absolutePath);
  if (!relative || relative === "") return ".";
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.replace(/\\/g, "/");
}

function isWithinPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  if (!relative || relative === "") return true;
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function buildCandidateError(
  errorCode: string,
  message: string,
  status: "blocked" | "failure",
  blockedReason?: string,
  details?: Record<string, unknown>
): { ok: false; error: ContentSourceResolveError } {
  return { ok: false, error: buildErrorValue(errorCode, message, status, blockedReason, details) };
}

function buildErrorValue(
  errorCode: string,
  message: string,
  status: "blocked" | "failure",
  blockedReason?: string,
  details?: Record<string, unknown>
): ContentSourceResolveError {
  return {
    errorCode,
    message,
    status,
    ...(blockedReason ? { blockedReason } : {}),
    ...(details ? { details } : {})
  };
}
