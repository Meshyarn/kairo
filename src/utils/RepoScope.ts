import path from "path";
import type { RepoConfig, RepoRegistry } from "../config/RepoRegistry.js";
import type { PathNormalizer } from "./PathNormalizer.js";

export type RepoScope =
  | { mode: "all" }
  | { mode: "default" }
  | { mode: "repos"; repoIds: string[] };

export type NormalizedRepoScope = {
  scope: RepoScope;
  repoIds: string[];
  includeUnscoped: boolean;
};

export type RepoResolution = {
  repoId: string;
  repoRelativePath?: string;
  repo?: RepoConfig;
  workspacePath: string;
};

type RepoScopeArgs = {
  repoScope?: RepoScope;
  repoId?: string;
  repoIds?: string[];
};

export function normalizeRepoScope(
  args: RepoScopeArgs,
  repoRegistry: RepoRegistry,
  options: { defaultMode: "all" | "default" }
): NormalizedRepoScope {
  const scope = resolveScopeInput(args, options.defaultMode);
  const allRepoIds = repoRegistry.getAllRepos().map((repo) => repo.id);

  if (scope.mode === "all") {
    return {
      scope,
      repoIds: allRepoIds,
      includeUnscoped: true
    };
  }

  if (scope.mode === "default") {
    const defaultRepo = repoRegistry.getDefaultRepo();
    if (!defaultRepo) {
      throw buildRepoScopeError("Default repository is not configured.");
    }
    return {
      scope,
      repoIds: [defaultRepo.id],
      includeUnscoped: false
    };
  }

  const repoIds = Array.isArray(scope.repoIds) ? scope.repoIds.filter(Boolean) : [];
  if (repoIds.length === 0) {
    throw buildRepoScopeError("repoScope.repoIds must include at least one repository.");
  }

  const uniqueIds = Array.from(new Set(repoIds));
  const invalid = uniqueIds.filter((id) => id !== "unscoped" && !allRepoIds.includes(id));
  if (invalid.length > 0) {
    throw buildRepoScopeError(`Unknown repoId(s): ${invalid.join(", ")}`);
  }

  return {
    scope: { mode: "repos", repoIds: uniqueIds },
    repoIds: uniqueIds.filter((id) => id !== "unscoped"),
    includeUnscoped: uniqueIds.includes("unscoped")
  };
}

export function resolveRepoInfo(
  filePath: string,
  repoRegistry: RepoRegistry,
  pathNormalizer: PathNormalizer
): RepoResolution {
  const workspacePath = pathNormalizer.normalize(filePath);
  const absolutePath = pathNormalizer.toAbsolute(workspacePath);
  const repo = repoRegistry.findRepoByPath(absolutePath);
  if (!repo) {
    return {
      repoId: "unscoped",
      workspacePath
    };
  }
  const repoRelativePath = path
    .relative(repo.path, absolutePath)
    .replace(/\\/g, "/");
  return {
    repoId: repo.id,
    repoRelativePath,
    repo,
    workspacePath
  };
}

export function isRepoIdInScope(repoId: string, scope: NormalizedRepoScope): boolean {
  if (repoId === "unscoped") {
    return scope.includeUnscoped;
  }
  return scope.repoIds.includes(repoId);
}

function resolveScopeInput(args: RepoScopeArgs, defaultMode: "all" | "default"): RepoScope {
  const repoScope = args.repoScope;
  if (repoScope && typeof repoScope === "object") {
    if (repoScope.mode === "all" || repoScope.mode === "default") {
      return { mode: repoScope.mode };
    }
    if (repoScope.mode === "repos") {
      return { mode: "repos", repoIds: Array.isArray(repoScope.repoIds) ? repoScope.repoIds : [] };
    }
    throw buildRepoScopeError("repoScope.mode must be one of: all, default, repos.");
  }

  if (Array.isArray(args.repoIds)) {
    return { mode: "repos", repoIds: args.repoIds };
  }
  if (typeof args.repoId === "string") {
    return { mode: "repos", repoIds: [args.repoId] };
  }

  return { mode: defaultMode };
}

function buildRepoScopeError(message: string): Error {
  const error = new Error(message);
  (error as any).code = "InvalidArguments";
  return error;
}
