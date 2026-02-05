import type { DependencyGraph } from '../../../ast/DependencyGraph.js';
import { buildDegradedReasons } from '../../DegradedReasonMapper.js';
import { runBatchChangeFlow } from './ChangePillarBatchFlow.js';
import { prepareSingleTargetChange } from './ChangePillarSingleTargetPrep.js';
import { runIntegrityPreflight, evaluateIntegrityGuardrailsFlow } from './ChangePillarIntegrityFlow.js';
import { evaluateRepoEditPolicy } from '../shared/RepoGuard.js';

export async function runChangeTargetingFlow(state: Record<string, any>): Promise<{ blockedResponse?: any }> {
  const {
    deps,
    intent,
    context,
    attachWorkflow
  } = state;

  const dependencyGraph = deps.registry.getMetadata('dependencyGraph') as DependencyGraph | undefined;
  state.dependencyGraph = dependencyGraph;

  const batchResult = await runBatchChangeFlow({
    shouldBatch: state.shouldBatch,
    useV2: state.useV2,
    v2Mode: state.v2Mode,
    intent,
    context,
    rawEdits: state.rawEdits,
    targetFiles: state.targetFiles,
    dryRun: state.dryRun,
    includeImpact: state.includeImpact,
    dependencyGraph,
    indexStateManager: state.indexStateManager,
    constraints: state.constraints,
    diffMode: state.diffMode,
    expectedFileVersions: state.expectedFileVersions,
    fileVersionManager: state.fileVersionManager,
    pathNormalizer: state.pathNormalizer,
    consumeApplyTokenOnce: state.consumeApplyTokenOnce,
    invalidateApplyTokenOnDrift: state.invalidateApplyTokenOnDrift,
    attachWorkflow,
    runTool: (ctx, tool, args) => deps.runTool(ctx, tool, args),
    getEditResolver: () => deps.getEditResolver(),
    getEditCoordinator: () => deps.getEditCoordinator(),
    originalIntent: state.originalIntent,
    resolvedSessionId: state.resolvedSessionId
  });
  if (batchResult) {
    return { blockedResponse: batchResult };
  }

  const targetPrep = await prepareSingleTargetChange({
    originalIntent: state.originalIntent,
    targets: state.targets,
    constraints: state.constraints,
    rawEdits: state.rawEdits,
    draftTargetPath: state.draftTargetPath,
    draftContent: state.draftContent,
    dryRun: state.dryRun,
    fileVersionManager: state.fileVersionManager,
    pathNormalizer: state.pathNormalizer,
    context,
    runTool: (ctx, tool, args) => deps.runTool(ctx, tool, args),
    buildSchemaCoaching: (args) => deps.buildSchemaCoaching(args),
    resolvedSessionId: state.resolvedSessionId
  });
  if (!targetPrep.ok) {
    return { blockedResponse: attachWorkflow(targetPrep.response) };
  }
  state.targetPath = targetPrep.targetPath;
  state.edits = targetPrep.edits;
  state.useDraftApply = targetPrep.useDraftApply;
  state.fileVersionsSnapshot = targetPrep.fileVersionsSnapshot;

  if (state.targetPath && state.repoRegistry && state.pathNormalizer && state.repoScope) {
    const guard = evaluateRepoEditPolicy({
      filePaths: [state.targetPath, ...state.editPaths],
      repoScope: state.repoScope,
      repoRegistry: state.repoRegistry,
      pathNormalizer: state.pathNormalizer,
      allowCrossRepoEdits: state.allowCrossRepoEdits
    });
    const blocked = state.handleRepoGuard(guard);
    if (blocked) {
      return { blockedResponse: blocked };
    }
  }

  const parityGate = await deps.resolveParityGate(state.targetPath, state.dryRun ? 'change_plan' : 'change_apply');
  state.parityDegradedReasons = parityGate.result.reasons.length > 0
    ? buildDegradedReasons(parityGate.result.reasons, {
      languageId: parityGate.result.languageId,
      filePath: state.targetPath
    })
    : undefined;
  if (state.traceBuilder) {
    state.traceBuilder.recordEvent({
      area: 'capabilities',
      code: 'parity_gate',
      data: {
        blocked: parityGate.blocked || parityGate.result.outcome === 'block',
        languageId: parityGate.result.languageId ?? null,
        reasons: parityGate.result.reasons.slice(0, 3)
      }
    });
  }
  if (parityGate.result.outcome === 'block') {
    if (state.traceBuilder) {
      state.traceBuilder.recordSkip('parity_gate', 'guardrail_blocked', 'language parity gate blocked');
    }
    const message = parityGate.message ?? 'Language parity requirements are missing.';
    return {
      blockedResponse: attachWorkflow({
        success: false,
        status: 'blocked',
        message,
        targetFile: state.targetPath,
        errorCode: 'LANGUAGE_PARITY_MISSING',
        blockedReason: parityGate.result.reasons[0] ?? 'language_parity_missing',
        blockingErrors: ['LANGUAGE_PARITY_MISSING'],
        degradedReasons: state.parityDegradedReasons,
        guidance: { message },
        sessionId: state.resolvedSessionId
      })
    };
  }

  if (state.integrityOptions && state.integrityOptions.mode !== 'off') {
    const integrityResult = await runIntegrityPreflight({
      integrityOptions: state.integrityOptions,
      originalIntent: state.originalIntent,
      targetPath: state.targetPath,
      dryRun: state.dryRun,
      runTool: (tool, args) => deps.runTool(context, tool, args)
    });
    state.integrityReport = integrityResult.report;
    if (integrityResult.blockedResponse) {
      return { blockedResponse: attachWorkflow(integrityResult.blockedResponse) };
    }
  }

  if (state.targetPath) {
    const guardrailFlow = await evaluateIntegrityGuardrailsFlow({
      targetPath: state.targetPath,
      fileSystem: state.fileSystem,
      useDraftApply: state.useDraftApply,
      draftContent: state.draftContent,
      edits: state.edits,
      dependencyGraph,
      indexStateManager: state.indexStateManager,
      constraints: state.constraints,
      runTool: (tool, args) => deps.runTool(context, tool, args),
      dryRun: state.dryRun,
      bypassIntegrityGuardrails: state.bypassIntegrityGuardrails,
      workflowWarnings: state.workflowWarnings,
      traceBuilder: state.traceBuilder
    });
    if (guardrailFlow.blockedResponse) {
      return { blockedResponse: attachWorkflow(guardrailFlow.blockedResponse) };
    }
    state.guardrailResult = guardrailFlow.guardrailResult;
    state.reviewOriginalContent = guardrailFlow.reviewOriginalContent;
    state.reviewNextContent = guardrailFlow.reviewNextContent;
    state.edits = guardrailFlow.edits;
  }

  return {};
}
