import type { RepoRegistry } from "../../../config/RepoRegistry.js";
import type { PathNormalizer } from "../../../utils/PathNormalizer.js";
import {
  isRepoIdInScope,
  resolveRepoInfo,
  type NormalizedRepoScope
} from "../../../utils/RepoScope.js";

export type RepoGuardResult = {
  blocked: boolean;
  blockedReason?: "cross_repo_scope_mismatch" | "cross_repo_edit_blocked";
  errorCode?: "CROSS_REPO_SCOPE_MISMATCH" | "CROSS_REPO_EDIT_BLOCKED";
  message?: string;
  repoIds?: string[];
  scope?: NormalizedRepoScope;
};

export function evaluateRepoEditPolicy(options: {
  filePaths: string[];
  repoScope: NormalizedRepoScope;
  repoRegistry: RepoRegistry;
  pathNormalizer: PathNormalizer;
  allowCrossRepoEdits: boolean;
}): RepoGuardResult {
  const uniquePaths = Array.from(new Set(options.filePaths.filter(Boolean)));
  if (uniquePaths.length === 0) return { blocked: false };

  const resolved: ReturnType<typeof resolveRepoInfo>[] = [];
  for (const filePath of uniquePaths) {
    try {
      resolved.push(resolveRepoInfo(filePath, options.repoRegistry, options.pathNormalizer));
    } catch {
      return {
        blocked: true,
        blockedReason: "cross_repo_scope_mismatch",
        errorCode: "CROSS_REPO_SCOPE_MISMATCH",
        message: `Blocked: invalid path outside workspace (${filePath}).`,
        repoIds: [],
        scope: options.repoScope
      };
    }
  }
  const repoIds = Array.from(new Set(resolved.map((entry) => entry.repoId)));

  const scopeMismatch = resolved.filter((entry) => !isRepoIdInScope(entry.repoId, options.repoScope));
  if (scopeMismatch.length > 0) {
    const reason = repoIds.filter((id) => id !== "unscoped").length > 1
      ? "cross_repo_edit_blocked"
      : "cross_repo_scope_mismatch";
    const errorCode = reason === "cross_repo_edit_blocked"
      ? "CROSS_REPO_EDIT_BLOCKED"
      : "CROSS_REPO_SCOPE_MISMATCH";
    return {
      blocked: true,
      blockedReason: reason,
      errorCode,
      message: buildScopeMismatchMessage(scopeMismatch.map((entry) => entry.workspacePath), options.repoScope),
      repoIds,
      scope: options.repoScope
    };
  }

  if (repoIds.includes("unscoped")) {
    return {
      blocked: true,
      blockedReason: "cross_repo_scope_mismatch",
      errorCode: "CROSS_REPO_SCOPE_MISMATCH",
      message: "Blocked: edits target files outside the configured repositories.",
      repoIds,
      scope: options.repoScope
    };
  }

  const distinctRepoIds = repoIds.filter((id) => id !== "unscoped");
  if (distinctRepoIds.length > 1 && !options.allowCrossRepoEdits) {
    return {
      blocked: true,
      blockedReason: "cross_repo_edit_blocked",
      errorCode: "CROSS_REPO_EDIT_BLOCKED",
      message: `Blocked: edits span multiple repositories (${distinctRepoIds.join(", ")}).`,
      repoIds: distinctRepoIds,
      scope: options.repoScope
    };
  }

  const invalidRepo = distinctRepoIds.find((repoId) => {
    const repo = options.repoRegistry.getRepo(repoId);
    if (!repo) return true;
    if (repo.type === "reference") return true;
    if (distinctRepoIds.length > 1 && !repo.allowCrossRepoEdits) return true;
    return false;
  });

  if (invalidRepo) {
    return {
      blocked: true,
      blockedReason: "cross_repo_edit_blocked",
      errorCode: "CROSS_REPO_EDIT_BLOCKED",
      message: `Blocked: repository policy forbids cross-repo edits (${invalidRepo}).`,
      repoIds: distinctRepoIds,
      scope: options.repoScope
    };
  }

  return { blocked: false, repoIds: distinctRepoIds, scope: options.repoScope };
}

function buildScopeMismatchMessage(paths: string[], scope: NormalizedRepoScope): string {
  const mode = scope.scope.mode;
  const sample = paths.slice(0, 3).join(", ");
  if (mode === "default") {
    return `Blocked: targets are outside the default repository (${sample}${paths.length > 3 ? ", …" : ""}).`;
  }
  if (mode === "repos") {
    return `Blocked: targets are outside the selected repositories (${sample}${paths.length > 3 ? ", …" : ""}).`;
  }
  return `Blocked: targets are outside the repo scope (${sample}${paths.length > 3 ? ", …" : ""}).`;
}
