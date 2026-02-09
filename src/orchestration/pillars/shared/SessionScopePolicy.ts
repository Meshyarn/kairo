import path from "path";
import type { RepoRegistry } from "../../../config/RepoRegistry.js";
import type { SessionPolicy, SessionRepoPolicy, SessionRepoScope } from "../../../types/flow-artifacts.js";

type PillarName = "explore" | "understand" | "write" | "change";

const hasOwn = (value: Record<string, any>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const isRecord = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const cloneRepoScope = (value: SessionRepoScope): SessionRepoScope => {
  if (value.mode === "repos") {
    return { mode: "repos", repoIds: Array.isArray(value.repoIds) ? [...value.repoIds] : [] };
  }
  return { mode: value.mode };
};

const sanitizeRepoIds = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const repoIds = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return repoIds.length > 0 ? repoIds : undefined;
};

const sanitizeRepoScope = (value: unknown): SessionRepoScope | undefined => {
  if (!isRecord(value)) return undefined;
  if (value.mode === "all") return { mode: "all" };
  if (value.mode === "default") return { mode: "default" };
  if (value.mode === "repos") {
    return { mode: "repos", repoIds: sanitizeRepoIds(value.repoIds) ?? [] };
  }
  return undefined;
};

const sanitizeRepoPolicy = (value: unknown): SessionRepoPolicy => {
  if (!isRecord(value)) return {};
  const repoScope = sanitizeRepoScope(value.repoScope);
  const repoId = typeof value.repoId === "string" && value.repoId.trim().length > 0
    ? value.repoId.trim()
    : undefined;
  const repoIds = sanitizeRepoIds(value.repoIds);
  const root = typeof value.root === "string" && value.root.trim().length > 0
    ? value.root.trim()
    : undefined;
  return {
    ...(root ? { root } : {}),
    ...(repoScope ? { repoScope } : {}),
    ...(repoId ? { repoId } : {}),
    ...(repoIds ? { repoIds } : {})
  };
};

const mergeRepoPolicy = (base: SessionRepoPolicy, override: SessionRepoPolicy): SessionRepoPolicy => ({
  ...base,
  ...override
});

const resolvePolicyForTool = (policy: SessionPolicy | undefined, tool: PillarName): SessionRepoPolicy => {
  if (!policy) return {};
  const topLevel = sanitizeRepoPolicy(policy);
  const toolLevel = sanitizeRepoPolicy((policy as Record<string, unknown>)[tool]);
  return mergeRepoPolicy(topLevel, toolLevel);
};

const hasExplicitRepoConstraints = (constraints: Record<string, any>): boolean =>
  hasOwn(constraints, "repoScope") || hasOwn(constraints, "repoId") || hasOwn(constraints, "repoIds");

const toAbsolute = (rootPath: string, value: string): string =>
  path.resolve(path.isAbsolute(value) ? value : path.resolve(rootPath, value));

const resolveRepoIdFromRootHint = (
  rootHint: string,
  repoRegistry: RepoRegistry,
  rootPath: string
): string | undefined => {
  const direct = repoRegistry.getRepo(rootHint);
  if (direct) return direct.id;

  const repos = repoRegistry.getAllRepos();
  if (repos.length === 0) return undefined;

  const exactName = repos.find((repo) => repo.name === rootHint);
  if (exactName) return exactName.id;

  const exactNameCaseInsensitive = repos.find((repo) => repo.name.toLowerCase() === rootHint.toLowerCase());
  if (exactNameCaseInsensitive) return exactNameCaseInsensitive.id;

  const hintAbsolute = toAbsolute(rootPath, rootHint);
  const candidates: Array<{ id: string; score: number }> = [];
  for (const repo of repos) {
    const repoPath = path.resolve(repo.path);
    const hintInRepo = hintAbsolute === repoPath || hintAbsolute.startsWith(`${repoPath}${path.sep}`);
    const repoInHint = repoPath.startsWith(`${hintAbsolute}${path.sep}`);
    if (!hintInRepo && !repoInHint) continue;
    const score = hintInRepo ? (100000 + repoPath.length) : repoPath.length;
    candidates.push({ id: repo.id, score });
  }

  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.id;
};

export function applySessionRepoScopeDefaults(args: {
  constraints: Record<string, any>;
  sessionPolicy?: SessionPolicy;
  tool: PillarName;
  repoRegistry?: RepoRegistry;
  rootPath?: string;
}): void {
  const { constraints, sessionPolicy, tool, repoRegistry } = args;
  if (!isRecord(constraints) || hasExplicitRepoConstraints(constraints)) return;

  const policy = resolvePolicyForTool(sessionPolicy, tool);
  if (policy.repoScope) {
    constraints.repoScope = cloneRepoScope(policy.repoScope);
    return;
  }
  if (policy.repoId) {
    constraints.repoId = policy.repoId;
    return;
  }
  if (Array.isArray(policy.repoIds) && policy.repoIds.length > 0) {
    constraints.repoIds = [...policy.repoIds];
    return;
  }
  if (!policy.root || !repoRegistry) return;

  const resolvedRootPath = typeof args.rootPath === "string" && args.rootPath.length > 0
    ? args.rootPath
    : process.cwd();
  const repoId = resolveRepoIdFromRootHint(policy.root, repoRegistry, resolvedRootPath);
  if (repoId) {
    constraints.repoScope = { mode: "repos", repoIds: [repoId] };
  }
}

export function buildSessionRepoScopePolicyPatch(args: {
  constraints: Record<string, any>;
  tool: PillarName;
}): Partial<SessionPolicy> | undefined {
  const { constraints, tool } = args;
  if (!isRecord(constraints)) return undefined;

  const toolPolicy: SessionRepoPolicy = {};
  if (hasOwn(constraints, "repoScope")) {
    const repoScope = sanitizeRepoScope(constraints.repoScope);
    if (repoScope) toolPolicy.repoScope = repoScope;
  }
  if (hasOwn(constraints, "repoId") && typeof constraints.repoId === "string" && constraints.repoId.trim().length > 0) {
    toolPolicy.repoId = constraints.repoId.trim();
  }
  if (hasOwn(constraints, "repoIds")) {
    const repoIds = sanitizeRepoIds(constraints.repoIds);
    if (repoIds) toolPolicy.repoIds = repoIds;
  }
  if (hasOwn(constraints, "root") && typeof constraints.root === "string" && constraints.root.trim().length > 0) {
    toolPolicy.root = constraints.root.trim();
  }

  if (Object.keys(toolPolicy).length === 0) {
    return undefined;
  }
  return {
    ...toolPolicy,
    [tool]: toolPolicy
  };
}
