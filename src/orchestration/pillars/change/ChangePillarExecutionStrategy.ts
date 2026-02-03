import { AuditLog } from '../../../utils/AuditLog.js';
import { ConfigurationManager } from '../../../config/ConfigurationManager.js';
import type { RepoRegistry } from '../../../config/RepoRegistry.js';
import type { PathNormalizer } from '../../../utils/PathNormalizer.js';
import type { FileVersionManager } from '../../../engine/FileVersionManager.js';
import type { IndexStateManager } from '../../../indexing/IndexStateManager.js';
import { buildDegradedReasons } from '../../DegradedReasonMapper.js';
import { evaluateStrategySearch } from './ChangePillarStrategySearch.js';
import { evaluateOverrideDecision } from '../shared/OverrideDecision.js';
import { normalizeRepoScope } from '../../../utils/RepoScope.js';
import { evaluateRepoEditPolicy } from '../shared/RepoGuard.js';
import { checkStaleGuard } from './ChangePillarImpactUtils.js';
import {
  collectEditPaths,
  normalizeLegacyContentSources,
  resolveContentSourcesForEdits
} from './ChangePillarEditUtils.js';
import { createIgnoreMatcher } from '../../../utils/ContentSourceResolver.js';

export async function applyChangeStrategyAndGuardrails(state: Record<string, any>): Promise<{ blockedResponse?: any }> {
  const {
    deps,
    intent,
    context,
    constraints,
    targets,
    traceBuilder,
    attachWorkflow,
    workflowWarnings,
    runTool,
    resolveCrossLangImpact
  } = state;

  state.rawEdits = normalizeLegacyContentSources(Array.isArray(constraints.edits) ? constraints.edits : []);
  state.targetFiles = deps.resolveTargetFiles(constraints, targets);
  state.editPaths = collectEditPaths(state.rawEdits);
  state.shouldBatch = deps.shouldUseBatch(constraints, state.targetFiles, state.editPaths);
  state.overrideTargets = state.targetFiles.length > 0 ? state.targetFiles : state.editPaths;

  const strategyOutcome = await evaluateStrategySearch({
    strategy: (constraints as any).strategySearch,
    context,
    intent,
    baseConstraints: constraints,
    baseTargets: targets,
    baseTargetFiles: state.targetFiles,
    baseDiffMode: state.diffMode,
    includeImpact: state.includeImpact,
    traceBuilder,
    registry: deps.registry,
    runTool,
    resolveFileSystem: () => deps.resolveFileSystem(),
    shouldUseBatch: (strategyConstraints, strategyTargetFiles, strategyEditPaths) =>
      deps.shouldUseBatch(strategyConstraints, strategyTargetFiles, strategyEditPaths),
    buildCrossLangImpact: resolveCrossLangImpact
  });
  if (strategyOutcome?.summary) {
    state.strategySearchSummary = strategyOutcome.summary;
  }
  if (strategyOutcome?.selected) {
    const selected = strategyOutcome.selected;
    state.rawEdits = selected.edits;
    if (Array.isArray(selected.targetFiles) && selected.targetFiles.length > 0) {
      constraints.targetFiles = selected.targetFiles;
      state.targetFiles = selected.targetFiles;
      if (selected.targetFiles.length === 1) {
        constraints.targetPath = selected.targetFiles[0];
        constraints.target = selected.targetFiles[0];
      }
    } else if (typeof selected.target === 'string' && selected.target.length > 0) {
      constraints.targetFiles = [selected.target];
      constraints.targetPath = selected.target;
      constraints.target = selected.target;
      state.targetFiles = [selected.target];
    } else {
      state.targetFiles = deps.resolveTargetFiles(constraints, targets);
    }
    if (typeof selected.intent === 'string' && selected.intent.length > 0) {
      state.refinedIntent = selected.intent;
    }
    if (selected.options && typeof selected.options === 'object') {
      if (typeof selected.options.includeImpact === 'boolean') {
        state.includeImpact = selected.options.includeImpact;
        constraints.includeImpact = selected.options.includeImpact;
      }
      if (typeof selected.options.diffMode === 'string') {
        state.diffMode = selected.options.diffMode;
      }
    }
    constraints.edits = state.rawEdits;
    state.editPaths = collectEditPaths(state.rawEdits);
    state.shouldBatch = deps.shouldUseBatch(constraints, state.targetFiles, state.editPaths);
    state.overrideTargets = state.targetFiles.length > 0 ? state.targetFiles : state.editPaths;
  }

  const overrideEvaluation = await evaluateOverrideDecision({
    constraints,
    targetFiles: state.overrideTargets,
    pillar: 'change',
    repoId: typeof (constraints as any).repoId === 'string' ? (constraints as any).repoId : undefined,
    auditLogAppend: AuditLog.append
  });
  state.overrideDecision = overrideEvaluation.decision ?? undefined;
  state.bypassIntegrityGuardrails = overrideEvaluation.bypass.integrityGuardrails;
  state.bypassReviewBlock = overrideEvaluation.bypass.reviewPolicy;
  state.bypassStaleGuard = overrideEvaluation.bypass.staleGuard;
  state.overrideTrace = overrideEvaluation.trace;
  if (traceBuilder) {
    traceBuilder.recordEvent({
      area: 'guardrails',
      code: 'override_evaluated',
      data: {
        decision: state.overrideDecision?.decision ?? 'none',
        bypassIntegrityGuardrails: state.bypassIntegrityGuardrails,
        bypassReviewBlock: state.bypassReviewBlock,
        bypassStaleGuard: state.bypassStaleGuard
      }
    });
  }
  if (overrideEvaluation.blockedResponse) {
    if (traceBuilder) {
      traceBuilder.recordSkip('override', 'guardrail_blocked', 'override not permitted');
    }
    return { blockedResponse: attachWorkflow(overrideEvaluation.blockedResponse) };
  }

  state.repoRegistry = deps.registry.getMetadata('repoRegistry') as RepoRegistry | undefined;
  state.pathNormalizer = deps.registry.getMetadata('pathNormalizer') as PathNormalizer | undefined;
  state.fileVersionManager = deps.registry.getMetadata('fileVersionManager') as FileVersionManager | undefined;
  state.indexStateManager = deps.registry.getMetadata('indexStateManager') as IndexStateManager | undefined;
  state.allowCrossRepoEdits = Boolean((constraints as any).allowCrossRepoEdits);
  const repoScopeParams = {
    repoScope: (constraints as any).repoScope,
    repoId: (constraints as any).repoId,
    repoIds: (constraints as any).repoIds
  };
  state.repoScope = state.repoRegistry && state.pathNormalizer
    ? normalizeRepoScope(repoScopeParams, state.repoRegistry, { defaultMode: 'default' })
    : undefined;
  if (traceBuilder && state.repoScope) {
    traceBuilder.recordEvent({
      area: 'policy',
      code: 'repo_scope_resolved',
      data: {
        mode: state.repoScope.scope.mode,
        repoIdsCount: Array.isArray(state.repoScope.repoIds) ? state.repoScope.repoIds.length : 0
      }
    });
  }

  state.handleRepoGuard = (guard: ReturnType<typeof evaluateRepoEditPolicy>) => {
    if (!guard.blocked) return null;
    const reason = guard.blockedReason ?? 'cross_repo_edit_blocked';
    const degradedReasons = buildDegradedReasons([reason]);
    const guidanceMessage = reason === 'cross_repo_edit_blocked'
      ? 'Set allowCrossRepoEdits=true in <KAIRO_DIR>/config/.mcp-config.json for involved repos, then rerun with allowCrossRepoEdits:true.'
      : 'Adjust repoScope to include the target repository or use the default repo.';
    if (traceBuilder) {
      traceBuilder.recordSkip('repo_scope', 'policy_disabled', reason);
    }
    return attachWorkflow({
      success: false,
      status: 'blocked',
      message: guard.message ?? 'Blocked by repo scope policy.',
      errorCode: guard.errorCode ?? 'CROSS_REPO_EDIT_BLOCKED',
      blockedReason: reason,
      degradedReasons,
      guidance: { message: guidanceMessage },
      sessionId: state.resolvedSessionId
    });
  };

  const v2Enabled = ConfigurationManager.getEditorV2Enabled();
  const v2Mode = ConfigurationManager.getEditorV2Mode();
  state.useV2 = v2Enabled && v2Mode !== 'off';
  state.v2Mode = v2Mode;

  if (state.shouldBatch && state.repoRegistry && state.pathNormalizer && state.repoScope) {
    const guard = evaluateRepoEditPolicy({
      filePaths: [...state.targetFiles, ...state.editPaths],
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

  const staleGuard = await checkStaleGuard({
    indexStateManager: state.indexStateManager,
    dryRun: state.dryRun,
    bypass: state.bypassStaleGuard,
    workflowWarnings
  });
  if (traceBuilder) {
    traceBuilder.recordEvent({
      area: 'guardrails',
      code: 'stale_guard',
      data: { blocked: staleGuard.blocked, bypassed: state.bypassStaleGuard }
    });
  }
  if (staleGuard.blocked) {
    if (traceBuilder) {
      traceBuilder.recordSkip('stale_guard', 'guardrail_blocked', 'index stale risk high');
    }
    return {
      blockedResponse: attachWorkflow({
        success: false,
        status: 'blocked',
        message: staleGuard.message,
        errorCode: 'INDEX_STALE_HIGH',
        blockedReason: 'index_stale_high',
        guidance: {
          message: staleGuard.message,
          suggestedActions: [
            {
              id: 'manage.reindex',
              priority: 1,
              description: 'Rebuild index before apply.',
              rationale: 'High stale risk reduces apply safety.',
              tags: ['repair_ladder', 'attempt_2'],
              toolCall: { tool: 'manage', args: { command: 'reindex' } }
            }
          ]
        },
        indexSnapshot: staleGuard.snapshot
      })
    };
  }

  const hasContentSources = state.rawEdits.some((edit: any) => Boolean(edit?.targetSource || edit?.replacementSource));
  if (hasContentSources) {
    const configurationManager = deps.registry.getMetadata('configurationManager') as ConfigurationManager | undefined;
    const ignoreGlobs = configurationManager?.getIgnoreGlobs?.() ?? [];
    const resolution = await resolveContentSourcesForEdits({
      edits: state.rawEdits,
      rootPath: deps.resolveRootPath(),
      fileSystem: state.fileSystem,
      repoRegistry: state.repoRegistry,
      repoScope: state.repoScope,
      pathNormalizer: state.pathNormalizer,
      artifactManager: state.artifactManager,
      ignoreMatcher: createIgnoreMatcher(ignoreGlobs)
    });
    if (!resolution.ok) {
      return {
        blockedResponse: attachWorkflow({
          success: false,
          status: resolution.error.status,
          message: resolution.error.message,
          errorCode: resolution.error.errorCode,
          blockedReason: resolution.error.blockedReason,
          contentSourceError: {
            ...resolution.error,
            editIndex: resolution.editIndex,
            field: resolution.field
          },
          guidance: {
            message: resolution.error.message,
            suggestedActions: []
          },
          sessionId: state.resolvedSessionId
        })
      };
    }
    if (traceBuilder && resolution.usage && (resolution.usage.targetSource || resolution.usage.replacementSource)) {
      traceBuilder.recordEvent({
        area: 'io',
        code: 'content_source_used',
        data: resolution.usage
      });
    }
    state.rawEdits = resolution.edits;
    constraints.edits = state.rawEdits;
  }

  return {};
}
