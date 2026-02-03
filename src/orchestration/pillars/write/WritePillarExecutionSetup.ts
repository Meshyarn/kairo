import type { InternalToolRegistry } from '../../InternalToolRegistry.js';
import type { OrchestrationContext } from '../../OrchestrationContext.js';
import type { ParsedIntent } from '../../IntentRouter.js';
import type { IFileSystem } from '../../../platform/FileSystem.js';
import type { WorkflowMeta } from '../../../types/flow-artifacts.js';
import type { FlowArtifactManager } from '../../flow-artifact-manager.js';
import type { FileVersionManager } from '../../../engine/FileVersionManager.js';
import type { RepoRegistry } from '../../../config/RepoRegistry.js';
import type { PathNormalizer } from '../../../utils/PathNormalizer.js';
import type { OptionSource, TraceOptionResolution } from '../../../types/option-trace.js';
import type { OverrideTrace } from '../../../utils/GuardrailsOverride.js';
import { resolveApplyHandshakePolicy } from '../../policy/McpModePresetRegistry.js';
import { normalizeWriteInput } from './WriteInputNormalizer.js';
import { buildWorkflowMeta, buildWorkflowWarnings } from '../shared/WorkflowMeta.js';
import { enforceWriteResponseBudget } from '../../budget/ResponseEnvelopeBudgeter.js';
import { resolveStylePack } from './WritePillarOptionUtils.js';
import { TraceBuilder } from '../../trace/TraceBuilder.js';
import { normalizeRepoScope } from '../../../utils/RepoScope.js';

export type WritePillarExecutionDeps = {
  registry: InternalToolRegistry;
  resolveRootPath: () => string;
  resolveFileSystem: () => IFileSystem;
  resolveEnvelopeBudget: (constraints: any) => { maxTokens?: number; maxChars?: number };
  resolveFormatterMode: (constraints: any) => string | undefined;
  applyFormatterIfNeeded: (mode: string | undefined, filePath: string, rollbackAvailable?: boolean) => Promise<any | undefined>;
  applyFormatterOutcome: <T extends Record<string, any>>(payload: T, formatterResult: any, filePath: string) => T;
  computeHash: (content: string) => { algorithm: 'xxhash' | 'sha256'; value: string };
  runTool: (ctx: OrchestrationContext, tool: string, args: any) => Promise<any>;
};

type InitializeWriteExecutionResult =
  | { state: Record<string, any> }
  | { blockedResponse: any };

const resolveOptionSource = (explicit: boolean, hasSession: boolean): OptionSource => {
  if (explicit) return "explicit";
  if (hasSession) return "session";
  return "default";
};

const buildStringResolution = (
  resolved: string | undefined,
  explicit: boolean,
  hasSession: boolean,
  requested?: unknown
): TraceOptionResolution<string | null> => ({
  source: resolveOptionSource(explicit, hasSession),
  explicit,
  resolved: resolved ?? null,
  ...(requested !== undefined ? { requested } : {})
});

export async function initializeWriteExecution(
  deps: WritePillarExecutionDeps,
  intent: ParsedIntent,
  context: OrchestrationContext
): Promise<InitializeWriteExecutionResult> {
  const artifactManager = deps.registry.getMetadata("flowArtifactManager") as FlowArtifactManager | undefined;
  const applyPolicy = resolveApplyHandshakePolicy();
  const input = normalizeWriteInput(intent, {
    resolveSessionId: (rawSessionId, fallback) => artifactManager?.resolveSessionId(rawSessionId, fallback),
    getSessionPolicy: (sessionId) => (sessionId ? artifactManager?.getSession(sessionId)?.policy : undefined),
    resolveDraftSessionId: (draftId) => {
      const artifact = artifactManager?.get(draftId) as any;
      return typeof artifact?.sessionId === "string" ? artifact.sessionId : undefined;
    }
  });
  const {
    constraints,
    targets,
    originalIntent,
    targetPath: inputTargetPath,
    template,
    content: initialContent,
    contentSource,
    hasExplicitContent,
    safeWrite,
    quickGenerate,
    smartWrite,
    styleReference,
    sessionPolicy,
    resolvedOptions,
    dryRun,
    traceEnabled,
    draftOptions,
    reviewOptions,
    draftId,
    applyToken,
    refinement
  } = input;
  let targetPath = inputTargetPath;
  let resolvedSessionId = input.resolvedSessionId;
  if (applyPolicy.required && dryRun && !resolvedSessionId && artifactManager) {
    resolvedSessionId = artifactManager.resolveSessionId("new", originalIntent);
  }
  const draftArtifact = draftId ? artifactManager?.get(draftId) : undefined;
  const sessionProfile = sessionPolicy?.write?.profile ?? sessionPolicy?.profile;
  const sessionSafety = sessionPolicy?.write?.safety ?? sessionPolicy?.safety;
  const traceBuilder = traceEnabled
    ? new TraceBuilder(
      "write",
      {
        profile: buildStringResolution(
          resolvedOptions.effective.profile,
          typeof constraints.profile === "string",
          Boolean(sessionProfile),
          typeof constraints.profile === "string" ? constraints.profile : undefined
        ),
        safety: buildStringResolution(
          resolvedOptions.effective.safety,
          typeof (constraints as any).safety === "string",
          Boolean(sessionSafety),
          typeof (constraints as any).safety === "string" ? (constraints as any).safety : undefined
        ),
        dryRun: {
          source: typeof constraints.dryRun === "boolean" ? "explicit" : (sessionSafety ? "session" : "computed"),
          explicit: typeof constraints.dryRun === "boolean",
          resolved: dryRun,
          ...(typeof constraints.dryRun === "boolean" ? { requested: constraints.dryRun } : {})
        },
        trace: {
          source: constraints.trace === true ? "explicit" : "default",
          explicit: constraints.trace === true,
          resolved: traceEnabled
        }
      },
      { startedAtMs: Date.now() }
    )
    : undefined;
  const formatterMode = deps.resolveFormatterMode(constraints);
  let content = initialContent;
  if (resolvedSessionId) {
    const policyPatch: Partial<{ profile?: string; safety?: string; write?: Record<string, unknown> }> = {};
    if (typeof constraints.profile === "string") {
      policyPatch.profile = constraints.profile;
      policyPatch.write = { ...(policyPatch.write ?? {}), profile: constraints.profile };
    }
    if (typeof (constraints as any).safety === "string") {
      policyPatch.safety = (constraints as any).safety;
      policyPatch.write = { ...(policyPatch.write ?? {}), safety: (constraints as any).safety };
    }
    if (Object.keys(policyPatch).length > 0) {
      artifactManager?.updateSessionPolicy(resolvedSessionId, policyPatch as any, "merge");
    }
  }
  const stylePackOverride = resolveStylePack((constraints as any).stylePack, artifactManager);
  const sessionStylePack = stylePackOverride
    ?? (resolvedSessionId && artifactManager
      ? artifactManager.getLatestStylePack(resolvedSessionId)
      : undefined);
  const draftPack = draftArtifact?.type === "draft" ? (draftArtifact as any).pack : undefined;
  const draftPhantomFiles = Array.isArray(draftPack?.phantomFiles) ? draftPack.phantomFiles : undefined;
  const draftPhantomFile = draftPhantomFiles?.length === 1 ? draftPhantomFiles[0] : undefined;
  const draftContent = typeof draftPhantomFile?.content === "string" ? draftPhantomFile.content : undefined;
  const draftTargetPath = typeof draftPhantomFile?.path === "string" ? draftPhantomFile.path : undefined;
  const expectedFileVersions = (constraints as any).fileVersions ?? draftPack?.fileVersions;
  if (!targetPath && draftTargetPath) {
    targetPath = draftTargetPath;
  }
  if (!hasExplicitContent && draftContent) {
    content = draftContent;
  }
  const workflowMeta = buildWorkflowMeta({
    sessionId: resolvedSessionId,
    dryRun,
    stylePack: sessionStylePack,
    artifactManager
  });
  const workflowWarnings = buildWorkflowWarnings(workflowMeta, Boolean(resolvedSessionId));
  const responseEnvelope = deps.resolveEnvelopeBudget(constraints);
  const repoRegistry = deps.registry.getMetadata("repoRegistry") as RepoRegistry | undefined;
  const pathNormalizer = deps.registry.getMetadata("pathNormalizer") as PathNormalizer | undefined;
  const fileVersionManager = deps.registry.getMetadata("fileVersionManager") as FileVersionManager | undefined;
  const allowCrossRepoEdits = Boolean((constraints as any).allowCrossRepoEdits);
  const repoScopeParams = {
    repoScope: (constraints as any).repoScope,
    repoId: (constraints as any).repoId,
    repoIds: (constraints as any).repoIds
  };
  const repoScope = repoRegistry && pathNormalizer
    ? normalizeRepoScope(repoScopeParams, repoRegistry, { defaultMode: "default" })
    : undefined;
  if (traceBuilder && repoScope) {
    traceBuilder.recordEvent({
      area: "policy",
      code: "repo_scope_resolved",
      data: {
        mode: repoScope.scope.mode,
        repoIdsCount: Array.isArray(repoScope.repoIds) ? repoScope.repoIds.length : 0
      }
    });
  }

  const state: Record<string, any> = {
    deps,
    intent,
    context,
    artifactManager,
    applyPolicy,
    input,
    constraints,
    targets,
    originalIntent,
    targetPath,
    template,
    content,
    contentSource,
    hasExplicitContent,
    safeWrite,
    quickGenerate,
    smartWrite,
    styleReference,
    sessionPolicy,
    resolvedOptions,
    dryRun,
    traceEnabled,
    draftOptions,
    reviewOptions,
    draftId,
    applyToken,
    refinement,
    resolvedSessionId,
    draftArtifact,
    sessionStylePack,
    draftPack,
    draftPhantomFiles,
    draftContent,
    draftTargetPath,
    expectedFileVersions,
    traceBuilder,
    workflowMeta,
    workflowWarnings,
    responseEnvelope,
    formatterMode,
    repoRegistry,
    pathNormalizer,
    fileVersionManager,
    allowCrossRepoEdits,
    repoScope,
    overrideTrace: undefined as OverrideTrace | undefined
  };

  state.attachSession = <T extends Record<string, any>>(payload: T): T & { sessionId?: string; workflowMeta: WorkflowMeta; workflowWarnings?: string[] } => {
    const next = {
      ...payload,
      workflowMeta: state.workflowMeta
    } as T & { sessionId?: string; workflowMeta: WorkflowMeta; workflowWarnings?: string[] };
    if (state.responseEnvelope.maxTokens || state.responseEnvelope.maxChars) {
      enforceWriteResponseBudget({
        response: next,
        maxTokens: state.responseEnvelope.maxTokens,
        maxChars: state.responseEnvelope.maxChars,
        traceBuilder: state.traceBuilder
      });
    }
    if (state.traceEnabled) {
      (next as any).effectiveOptions = {
        version: 1,
        pillar: "write",
        profile: state.resolvedOptions.effective.profile,
        safety: state.resolvedOptions.effective.safety,
        dryRun: state.dryRun,
        reviewOptions: state.reviewOptions,
        diffMode: state.resolvedOptions.effective.diffMode
      };
      (next as any).decisionTrace = state.traceBuilder?.finalize();
    }
    if (state.workflowWarnings.length > 0) {
      next.workflowWarnings = state.workflowWarnings;
    }
    if (state.overrideTrace) {
      (next as any).overrideTrace = state.overrideTrace;
    }
    return state.resolvedSessionId ? { ...next, sessionId: state.resolvedSessionId } : next;
  };

  return { state };
}
