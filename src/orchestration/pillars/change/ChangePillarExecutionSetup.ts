import type { ParsedIntent } from '../../IntentRouter.js';
import type { OrchestrationContext } from '../../OrchestrationContext.js';
import type { InternalToolRegistry } from '../../InternalToolRegistry.js';
import { metrics } from '../../../utils/MetricsCollector.js';
import type { DependencyGraph } from '../../../ast/DependencyGraph.js';
import { FeatureFlags } from '../../../config/FeatureFlags.js';
import type { WorkflowMeta } from '../../../types/flow-artifacts.js';
import { TraceBuilder } from '../../trace/TraceBuilder.js';
import type { OptionSource, TraceOptionResolution } from '../../../types/option-trace.js';
import { normalizeChangeInput } from './ChangeInputNormalizer.js';
import { buildWorkflowMeta, buildWorkflowWarnings } from '../shared/WorkflowMeta.js';
import { resolveStylePack } from './ChangePillarReviewUtils.js';
import { createApplyTokenState } from './ChangePillarApplyTokenUtils.js';
import { buildCrossLangImpact } from './ChangePillarContractImpact.js';
import type { UnifiedContextGraph } from '../../context/UnifiedContextGraph.js';
import type { FlowArtifactManager } from '../../flow-artifact-manager.js';
import { enforceChangeResponseBudget } from '../../budget/ResponseEnvelopeBudgeter.js';
import { resolveApplyHandshakePolicy } from '../../policy/McpModePresetRegistry.js';
import {
  computeAdaptiveFlowGate,
  recordAdaptiveFlowGateTrace,
  resolveRolloutPresetFromEnv,
  setAdaptiveFlowGate
} from '../../adaptive-flow/AdaptiveFlowGate.js';

export type ChangePillarExecutionDeps = {
  registry: InternalToolRegistry;
  resolveRootPath: () => string;
  resolveFileSystem: () => any;
  getEditCoordinator: () => any;
  getEditResolver: () => any;
  runTool: (ctx: OrchestrationContext, tool: string, args: any) => Promise<any>;
  resolveTargetFiles: (constraints: any, targets: string[]) => string[];
  resolveEnvelopeBudget: (constraints: any) => { maxTokens?: number; maxChars?: number };
  resolveParityGate: (targetPath: string, operation: 'change_plan' | 'change_apply') => Promise<{ blocked: boolean; message?: string; result: any }>;
  buildSchemaCoaching: (args: { errorCode: string; targetPath?: string; intent?: string }) => any;
  shouldUseBatch: (constraints: any, targetFiles: string[], editPaths: string[]) => boolean;
  buildCrossLangImpact?: (
    targetPath: string,
    ctx: OrchestrationContext,
    options?: { force?: boolean; changedExports?: string[]; afterContent?: string }
  ) => Promise<any>;
};

type InitializeChangeExecutionResult =
  | { state: Record<string, any> }
  | { blockedResponse: any };

const resolveOptionSource = (explicit: boolean, hasSession: boolean): OptionSource => {
  if (explicit) return 'explicit';
  if (hasSession) return 'session';
  return 'default';
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

const resolveFormatterMode = (constraints: any): string | undefined => {
  if (typeof constraints?.formatter === 'string') return constraints.formatter;
  if (typeof constraints?.options?.formatter === 'string') return constraints.options.formatter;
  return undefined;
};

export async function initializeChangeExecution(
  deps: ChangePillarExecutionDeps,
  intent: ParsedIntent,
  context: OrchestrationContext
): Promise<InitializeChangeExecutionResult> {
  const fileSystem = deps.resolveFileSystem();
  const runTool = (ctx: OrchestrationContext, tool: string, args: any) => deps.runTool(ctx, tool, args);
  const resolveCrossLangImpact = deps.buildCrossLangImpact
    ? (targetPath: string, ctx: OrchestrationContext, options?: { force?: boolean; changedExports?: string[]; afterContent?: string }) =>
        deps.buildCrossLangImpact!(targetPath, ctx, options)
    : (
    targetPath: string,
    ctx: OrchestrationContext,
    options?: { force?: boolean; changedExports?: string[]; afterContent?: string }
  ) => buildCrossLangImpact({
      targetPath,
      context: ctx,
      registry: deps.registry,
      rootPath: deps.resolveRootPath(),
      fileSystem,
      runTool,
      options
    });
  const ucg = context.getState<UnifiedContextGraph>('ucg');
  const artifactManager = deps.registry.getMetadata('flowArtifactManager') as FlowArtifactManager | undefined;
  const applyPolicy = resolveApplyHandshakePolicy();
  const input = normalizeChangeInput(intent, {
    resolveSessionId: (rawSessionId, fallback) => artifactManager?.resolveSessionId(rawSessionId, fallback),
    getSessionPolicy: (sessionId) => (sessionId ? artifactManager?.getSession(sessionId)?.policy : undefined),
    resolveDraftSessionId: (draftId) => {
      const artifact = artifactManager?.get(draftId) as any;
      return typeof artifact?.sessionId === 'string' ? artifact.sessionId : undefined;
    }
  });
  const {
    targets,
    constraints,
    originalIntent,
    integrityOptions,
    sessionPolicy,
    resolvedOptions,
    dryRun,
    traceEnabled,
    draftId,
    applyToken,
    refinement
  } = input;
  let resolvedSessionId = input.resolvedSessionId;
  const draftArtifact = draftId ? artifactManager?.get(draftId) : undefined;
  let { includeImpact, includeSymbolImpact, reviewOptions, diffMode, refinedIntent } = input;
  if (applyPolicy.required && dryRun && !resolvedSessionId && artifactManager) {
    resolvedSessionId = artifactManager.resolveSessionId('new', originalIntent);
  }
  if (!dryRun && !resolvedSessionId && typeof (draftArtifact as any)?.sessionId === 'string') {
    resolvedSessionId = (draftArtifact as any).sessionId;
  }
  if (dryRun) {
    metrics.inc('change.plan_total');
  } else {
    metrics.inc('change.apply_total');
  }
  const sessionProfile = sessionPolicy?.change?.profile ?? sessionPolicy?.profile;
  const sessionSafety = sessionPolicy?.change?.safety ?? sessionPolicy?.safety;
  const traceBuilder = traceEnabled
    ? new TraceBuilder(
      'change',
      {
        profile: buildStringResolution(
          resolvedOptions.effective.profile,
          typeof constraints.profile === 'string',
          Boolean(sessionProfile),
          typeof constraints.profile === 'string' ? constraints.profile : undefined
        ),
        safety: buildStringResolution(
          resolvedOptions.effective.safety,
          typeof (constraints as any).safety === 'string',
          Boolean(sessionSafety),
          typeof (constraints as any).safety === 'string' ? (constraints as any).safety : undefined
        ),
        dryRun: {
          source: typeof constraints.dryRun === 'boolean' ? 'explicit' : (sessionSafety ? 'session' : 'computed'),
          explicit: typeof constraints.dryRun === 'boolean',
          resolved: dryRun,
          ...(typeof constraints.dryRun === 'boolean' ? { requested: constraints.dryRun } : {})
        },
        trace: {
          source: constraints.trace === true ? 'explicit' : 'default',
          explicit: constraints.trace === true,
          resolved: traceEnabled
        }
      },
      { startedAtMs: Date.now() }
    )
    : undefined;
  let fileCount: number | undefined;
  const rolloutDependencyGraph = deps.registry.getMetadata('dependencyGraph') as DependencyGraph | undefined;
  if (rolloutDependencyGraph?.getIndexStatus) {
    try {
      const status = await rolloutDependencyGraph.getIndexStatus();
      if (typeof status?.global?.totalFiles === 'number') {
        fileCount = status.global.totalFiles;
      }
    } catch {
      fileCount = undefined;
    }
  }
  const gate = computeAdaptiveFlowGate({
    profile: resolvedOptions.effective.profile,
    fileCount
  });
  setAdaptiveFlowGate(context, gate);
  if (traceBuilder) {
    recordAdaptiveFlowGateTrace(traceBuilder, gate, {
      rolloutMode: resolveRolloutPresetFromEnv() ?? FeatureFlags.getMode(FeatureFlags.ADAPTIVE_FLOW_ENABLED),
      userIdResolved: Boolean(FeatureFlags.getContext()?.userId)
    });
  }
  if (resolvedSessionId) {
    const policyPatch: Partial<{ profile?: string; safety?: string; change?: Record<string, unknown> }> = {};
    if (typeof constraints.profile === 'string') {
      policyPatch.profile = constraints.profile;
      policyPatch.change = { ...(policyPatch.change ?? {}), profile: constraints.profile };
    }
    if (typeof (constraints as any).safety === 'string') {
      policyPatch.safety = (constraints as any).safety;
      policyPatch.change = { ...(policyPatch.change ?? {}), safety: (constraints as any).safety };
    }
    if (Object.keys(policyPatch).length > 0) {
      artifactManager?.updateSessionPolicy(resolvedSessionId, policyPatch as any, 'merge');
    }
  }
  const draftPackFromId = draftArtifact?.type === 'draft' ? (draftArtifact as any).pack : undefined;
  const draftPhantom = draftPackFromId?.phantomFiles?.[0];
  const draftContent = typeof draftPhantom?.content === 'string' ? draftPhantom.content : undefined;
  const draftTargetPath = typeof draftPhantom?.path === 'string' ? draftPhantom.path : undefined;
  const expectedFileVersions = (constraints as any).fileVersions ?? draftPackFromId?.fileVersions;
  const stylePackOverride = resolveStylePack((constraints as any).stylePack, artifactManager);
  const sessionStylePack = stylePackOverride
    ?? (resolvedSessionId && artifactManager
      ? artifactManager.getLatestStylePack(resolvedSessionId)
      : undefined);
  const workflowMeta = buildWorkflowMeta({
    sessionId: resolvedSessionId,
    dryRun,
    stylePack: sessionStylePack,
    artifactManager
  });
  const workflowWarnings = buildWorkflowWarnings(workflowMeta, Boolean(resolvedSessionId));
  const responseEnvelope = deps.resolveEnvelopeBudget(constraints);
  const state: Record<string, any> = {
    deps,
    intent,
    context,
    fileSystem,
    runTool,
    resolveCrossLangImpact,
    ucg,
    artifactManager,
    applyPolicy,
    input,
    targets,
    constraints,
    originalIntent,
    integrityOptions,
    sessionPolicy,
    resolvedOptions,
    dryRun,
    traceEnabled,
    draftId,
    applyToken,
    refinement,
    resolvedSessionId,
    draftArtifact,
    draftContent,
    draftTargetPath,
    expectedFileVersions,
    includeImpact,
    includeSymbolImpact,
    reviewOptions,
    diffMode,
    refinedIntent,
    traceBuilder,
    workflowMeta,
    workflowWarnings,
    responseEnvelope,
    sessionStylePack,
    strategySearchSummary: undefined,
    overrideTrace: undefined
  };
  state.attachWorkflow = <T extends Record<string, any>>(payload: T): T & { workflowMeta: WorkflowMeta; workflowWarnings?: string[] } => {
    const next = {
      ...payload,
      workflowMeta: state.workflowMeta,
      ...(state.strategySearchSummary ? { strategySearch: state.strategySearchSummary } : {})
    } as T & { workflowMeta: WorkflowMeta; workflowWarnings?: string[] };
    if (state.responseEnvelope.maxTokens || state.responseEnvelope.maxChars) {
      enforceChangeResponseBudget({
        response: next,
        maxTokens: state.responseEnvelope.maxTokens,
        maxChars: state.responseEnvelope.maxChars,
        traceBuilder: state.traceBuilder
      });
    }
    if (state.traceEnabled) {
      (next as any).effectiveOptions = {
        version: 1,
        pillar: 'change',
        profile: state.resolvedOptions.effective.profile,
        safety: state.resolvedOptions.effective.safety,
        dryRun: state.dryRun,
        reviewOptions: state.reviewOptions,
        diffMode: state.diffMode
      };
      (next as any).decisionTrace = state.traceBuilder?.finalize();
    }
    if (state.workflowWarnings.length > 0) {
      next.workflowWarnings = state.workflowWarnings;
    }
    if (state.overrideTrace) {
      (next as any).overrideTrace = state.overrideTrace;
    }
    return next;
  };

  let rawEdits = Array.isArray(constraints.edits) ? constraints.edits : [];
  let targetFiles = deps.resolveTargetFiles(constraints, targets);
  let editPaths: string[] = [];
  const shouldBatch = deps.shouldUseBatch(constraints, targetFiles, editPaths);
  const overrideTargets = targetFiles.length > 0 ? targetFiles : editPaths;
  const formatterMode = resolveFormatterMode(constraints);
  const requireApplyToken = applyPolicy.required && !dryRun;
  const invalidateApplyTokenOnDrift = () => {
    if (!applyPolicy.invalidateOnDrift || dryRun || !resolvedSessionId || !draftId) return;
    artifactManager?.invalidateApplyToken(resolvedSessionId, draftId);
  };
  const applyTokenState = createApplyTokenState({
    applyPolicy,
    requireApplyToken,
    artifactManager,
    draftId,
    applyToken,
    originalIntent,
    refinement,
    getResolvedSessionId: () => state.resolvedSessionId,
    getTargetFiles: () => state.targetFiles,
    getRawEdits: () => state.rawEdits
  });
  const consumeApplyTokenOnce = () => applyTokenState.consumeApplyTokenOnce();

  state.rawEdits = rawEdits;
  state.targetFiles = targetFiles;
  state.editPaths = editPaths;
  state.shouldBatch = shouldBatch;
  state.overrideTargets = overrideTargets;
  state.formatterMode = formatterMode;
  state.requireApplyToken = requireApplyToken;
  state.invalidateApplyTokenOnDrift = invalidateApplyTokenOnDrift;
  state.applyTokenState = applyTokenState;
  state.consumeApplyTokenOnce = consumeApplyTokenOnce;

  if (requireApplyToken) {
    const validation = applyTokenState.validateApplyToken(false);
    if (!validation.valid) {
      return { blockedResponse: state.attachWorkflow(applyTokenState.buildApplyTokenBlockedResponse(validation)) };
    }
  }

  return { state };
}
