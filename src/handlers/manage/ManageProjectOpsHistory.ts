import type { ManageHandlerDeps } from "./ManageHandlerUtils.js";
import { buildEvidenceArtifactResponse, buildGraphArtifactResponse, resolveManageEnvelopeBudget } from "./ManageArtifactUtils.js";
import { buildWorkflowSummary } from "./ManageWorkflowUtils.js";
import { sanitizeHistoryStacks, summarizeCheckpoints } from "./ManageHistoryUtils.js";

export const handleHistory = async (deps: ManageHandlerDeps, args: any) => {
  const context = deps.context;
  const history = await context.historyEngine.getHistory();
  const detail = args?.detail === "full" ? "full" : "summary";
  const log = context.editCoordinator.getTransactionLog();
  const pending = log ? log.getPendingTransactions() : [];
  const checkpointLimit = typeof args?.checkpointLimit === "number" ? args.checkpointLimit : 10;
  const committed = log ? log.listTransactions({ status: "committed", limit: checkpointLimit }) : [];
  const sanitized = sanitizeHistoryStacks(context, history, { includeExternal: detail === "full" });
  return {
    success: true,
    output: "History retrieved.",
    history: {
      undo: sanitized.undoStack,
      redo: sanitized.redoStack,
      pendingTransactions: pending,
      checkpoints: summarizeCheckpoints(committed)
    },
    ...(sanitized.hiddenCount > 0
      ? { historyMeta: { externalPathsHidden: sanitized.hiddenCount, detail } }
      : {})
  };
};

export const handleSessions = (deps: ManageHandlerDeps, args: any) => {
  const context = deps.context;
  const options = args?.artifactOptions ?? {};
  const limit = typeof args?.limit === "number" ? args.limit : (options?.limit ?? 10);
  const statusFilter = typeof options?.status === "string" ? options.status : undefined;
  const sort = options?.sort === "updated" ? "updated" : "recent";
  let sessions = context.flowArtifactManager.listSessions(limit * 2);
  if (statusFilter) {
    sessions = sessions.filter((session) => session.status === statusFilter);
  }
  sessions = sessions
    .sort((a, b) => {
      const aTime = a.updatedAt ?? a.startedAt;
      const bTime = b.updatedAt ?? b.startedAt;
      return sort === "updated" ? bTime - aTime : bTime - aTime;
    })
    .slice(0, limit);
  const summary = buildWorkflowSummary(context);
  return {
    success: true,
    output: "Sessions listed.",
    sessions,
    ...(summary.recommendedActions ? { recommendedActions: summary.recommendedActions } : {})
  };
};

export const handleSession = (deps: ManageHandlerDeps, args: any) => {
  const context = deps.context;
  const target = args?.target ?? args?.sessionId ?? args?.artifactOptions?.sessionId;
  if (!target) {
    return { success: false, output: "Missing target session id." };
  }
  const summary = context.flowArtifactManager.getSessionSummary(target);
  const session = summary?.session;
  return {
    success: Boolean(session),
    output: session ? "Session retrieved." : "Session not found.",
    session,
    summary: summary?.summary
  };
};

export const handleSessionComplete = (deps: ManageHandlerDeps, args: any) => {
  const context = deps.context;
  const target = args?.target ?? args?.sessionId ?? args?.artifactOptions?.sessionId;
  if (!target) {
    return { success: false, output: "Missing target session id." };
  }
  const outcome = args?.outcome;
  const completed = context.flowArtifactManager.completeSession(target, outcome);
  const summary = completed ? context.flowArtifactManager.getSessionSummary(target) : undefined;
  return {
    success: Boolean(completed),
    output: completed ? "Session completed." : "Session not found.",
    session: completed,
    summary: summary?.summary
  };
};

export const handleSessionUpdate = async (deps: ManageHandlerDeps, args: any) => {
  const context = deps.context;
  const target = args?.target ?? args?.sessionId ?? args?.artifactOptions?.sessionId;
  if (!target) {
    return { success: false, output: "Missing target session id." };
  }
  const policy = mergeSessionPolicy(
    buildSessionPolicyPatchFromArgs(args),
    isRecord(args?.policy) ? args.policy : undefined
  );
  const policyMode = args?.policyMode === "replace" ? "replace" : "merge";
  const updated = await context.flowArtifactManager.updateSessionPolicy(target, policy, policyMode);
  const summary = updated ? context.flowArtifactManager.getSessionSummary(target) : undefined;
  return {
    success: Boolean(updated),
    output: updated ? "Session policy updated." : "Session not found.",
    session: updated,
    summary: summary?.summary
  };
};

export const handleArtifacts = (deps: ManageHandlerDeps, args: any) => {
  const context = deps.context;
  const options = args?.artifactOptions ?? {};
  const limit = typeof options.limit === "number" ? options.limit : 10;
  const sort = options?.sort === "expiring" ? "expiring" : "recent";
  let artifacts = context.flowArtifactManager.getRecent(limit * 2);
  if (options.type) {
    artifacts = artifacts.filter((artifact) => artifact.type === options.type);
  }
  if (options.sessionId) {
    artifacts = artifacts.filter((artifact) => artifact.sessionId === options.sessionId);
  }
  if (options.includeExpired !== true) {
    const now = Date.now();
    artifacts = artifacts.filter((artifact) => !artifact.expiresAt || artifact.expiresAt > now);
  }
  if (sort === "expiring") {
    artifacts = artifacts.sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
  }
  artifacts = artifacts.slice(0, limit);
  const sanitized = artifacts.map((artifact) => {
    if (artifact.type === "graph") {
      const pack = (artifact as any).pack;
      if (!pack) return artifact;
      return {
        ...artifact,
        pack: {
          ...pack,
          raw: undefined
        }
      };
    }
    if (artifact.type === "evidence") {
      const pack = (artifact as any).pack;
      if (!pack) return artifact;
      return {
        ...artifact,
        pack: {
          ...pack,
          rankedFiles: Array.isArray(pack.rankedFiles) ? pack.rankedFiles.slice(0, 5) : [],
          evidence: Array.isArray(pack.evidence) ? pack.evidence.slice(0, 2) : []
        }
      };
    }
    return artifact;
  });
  const summary = buildWorkflowSummary(context);
  return {
    success: true,
    output: "Artifacts listed.",
    artifacts: sanitized,
    ...(summary.recommendedActions ? { recommendedActions: summary.recommendedActions } : {})
  };
};

export const handleArtifact = (deps: ManageHandlerDeps, args: any) => {
  const context = deps.context;
  const target = args?.target;
  if (!target) {
    return { success: false, output: "Missing target artifact id." };
  }
  const artifact = context.flowArtifactManager.get(target);
  if (artifact?.type === "graph") {
    const detail = args?.detail === "full" ? "full" : "summary";
    const limit = Number.isFinite(args?.limit) && args.limit > 0 ? Math.floor(args.limit) : undefined;
    const envelopeBudget = resolveManageEnvelopeBudget(args);
    return buildGraphArtifactResponse(artifact, {
      detail,
      limit,
      ...envelopeBudget
    });
  }
  if (artifact?.type === "evidence") {
    const detail = args?.detail === "full" ? "full" : "summary";
    const envelopeBudget = resolveManageEnvelopeBudget(args);
    return buildEvidenceArtifactResponse(artifact, {
      detail,
      ...envelopeBudget
    });
  }
  return {
    success: Boolean(artifact),
    output: artifact ? "Artifact retrieved." : "Artifact not found.",
    artifact
  };
};

export const handleDiscard = (deps: ManageHandlerDeps, args: any) => {
  const context = deps.context;
  const target = args?.target;
  if (!target) {
    return { success: false, output: "Missing target artifact id." };
  }
  const discarded = context.flowArtifactManager.discard(target);
  return {
    success: discarded,
    output: discarded ? "Artifact discarded." : "Artifact not found."
  };
};

const isRecord = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const sanitizeRepoIds = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const repoIds = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return repoIds.length > 0 ? repoIds : undefined;
};

const cloneRepoScope = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined;
  if (value.mode === "all" || value.mode === "default") {
    return { mode: value.mode };
  }
  if (value.mode === "repos") {
    return { mode: "repos", repoIds: sanitizeRepoIds(value.repoIds) ?? [] };
  }
  return undefined;
};

const mergeSessionPolicy = (
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!base && !override) return undefined;
  const merged: Record<string, unknown> = { ...(base ?? {}), ...(override ?? {}) };
  for (const tool of ["explore", "understand", "write", "change"] as const) {
    const lhs = isRecord(base?.[tool]) ? (base?.[tool] as Record<string, unknown>) : undefined;
    const rhs = isRecord(override?.[tool]) ? (override?.[tool] as Record<string, unknown>) : undefined;
    if (lhs || rhs) {
      merged[tool] = { ...(lhs ?? {}), ...(rhs ?? {}) };
    }
  }
  return merged;
};

const buildSessionPolicyPatchFromArgs = (args: any): Record<string, unknown> | undefined => {
  const policy: Record<string, unknown> = {};
  if (typeof args?.root === "string" && args.root.trim().length > 0) {
    policy.root = args.root.trim();
  }
  const repoScope = cloneRepoScope(args?.repoScope);
  if (repoScope) {
    policy.repoScope = repoScope;
  }
  if (typeof args?.repoId === "string" && args.repoId.trim().length > 0) {
    policy.repoId = args.repoId.trim();
  }
  const repoIds = sanitizeRepoIds(args?.repoIds);
  if (repoIds) {
    policy.repoIds = repoIds;
  }
  return Object.keys(policy).length > 0 ? policy : undefined;
};
