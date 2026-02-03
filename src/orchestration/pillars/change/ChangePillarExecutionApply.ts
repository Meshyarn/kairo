import { ChangeBudgetManager } from '../../ChangeBudgetManager.js';
import { DraftPackBuilder } from '../../../generation/draft-pack-builder.js';
import { buildDegradedReasons } from '../../DegradedReasonMapper.js';
import { applyFormatterBridge } from '../../formatter/FormatterBridge.js';
import { shouldSuggestDocs, suggestDocUpdates } from './DocumentSuggestion.js';
import { buildFailureGuidance } from './ChangePillarReviewUtils.js';
import { shouldSuggestImpact } from './ChangePillarImpactUtils.js';
import {
  createSymbolicTraceRecorder,
  evaluatePreApplyReviewBlock,
  runReviewWithTrace
} from './ChangePillarReviewFlow.js';
import { createImpactTasks, finalizeImpactReport } from './ChangePillarImpactFlow.js';
import { runEditTransactionFlow } from './ChangePillarEditFlow.js';
import { AuditLog } from '../../../utils/AuditLog.js';

export async function executeChangeApplyFlow(state: Record<string, any>): Promise<any> {
  const budget = ChangeBudgetManager.create({
    intentText: state.refinedIntent,
    targetSample: state.edits[0]?.targetString,
    includeImpact: state.includeImpact,
    dryRun: state.dryRun,
    editCount: state.edits.length,
    batchMode: Boolean(state.constraints?.batchMode)
  });
  const allowImpactPreview = state.includeImpact === true;

  const blockOn = Array.isArray(state.reviewOptions?.blockOn) ? state.reviewOptions.blockOn : [];
  const shouldBlockOn = !state.dryRun && blockOn.length > 0 && Boolean(state.targetPath);
  const shouldComputeReview = Boolean(state.targetPath)
    && (shouldBlockOn || (state.reviewOptions?.preApply ?? state.dryRun) || (state.reviewOptions?.postApply && !state.dryRun));
  const publicSurface = state.guardrailResult?.architecturalRisk?.publicSurface;
  const forcedExports = Array.isArray(publicSurface?.changes)
    ? publicSurface.changes.map((change: any) => change?.name).filter((name: any) => typeof name === 'string')
    : [];
  let crossLangImpact: any = undefined;
  if (state.targetPath && (state.includeImpact || shouldComputeReview)) {
    crossLangImpact = await state.resolveCrossLangImpact(state.targetPath, state.context, {
      force: Boolean(publicSurface?.hasChanges),
      changedExports: forcedExports,
      afterContent: state.reviewNextContent
    });
  }
  let preApplyReview: any = undefined;
  let preApplyReviewComputed = false;
  let formatterResult: Awaited<ReturnType<typeof applyFormatterBridge>> = undefined;
  const recordSymbolicTrace = createSymbolicTraceRecorder(state.traceBuilder);
  if (shouldBlockOn && state.targetPath) {
    const reviewBlock = await evaluatePreApplyReviewBlock({
      filePath: state.targetPath,
      content: state.reviewNextContent ?? state.reviewOriginalContent ?? '',
      oldContent: state.reviewOriginalContent,
      guardrailResult: state.guardrailResult,
      constraints: state.constraints,
      stylePack: state.sessionStylePack,
      contractImpact: crossLangImpact,
      reviewOptions: state.reviewOptions,
      dependencyGraph: state.dependencyGraph,
      indexStateManager: state.indexStateManager,
      traceBuilder: state.traceBuilder,
      recordSymbolicTrace,
      bypassReviewBlock: state.bypassReviewBlock,
      workflowWarnings: state.workflowWarnings,
      artifactManager: state.artifactManager,
      resolvedSessionId: state.resolvedSessionId,
      originalIntent: state.originalIntent
    });
    preApplyReview = reviewBlock.review;
    preApplyReviewComputed = reviewBlock.computed;
    if (reviewBlock.blockedResponse) {
      return state.attachWorkflow(reviewBlock.blockedResponse);
    }
  }

  const impactTasks = createImpactTasks({
    budget,
    targetPath: state.targetPath,
    dryRun: state.dryRun,
    includeImpact: state.includeImpact,
    edits: state.edits,
    context: state.context,
    ucg: state.ucg,
    includeSymbolImpact: state.includeSymbolImpact,
    constraints: state.constraints,
    fileSystem: state.fileSystem,
    runTool: (ctx, tool, args) => state.deps.runTool(ctx, tool, args)
  });

  const editFlow = await runEditTransactionFlow({
    context: state.context,
    targetPath: state.targetPath,
    edits: state.edits,
    dryRun: state.dryRun,
    diffMode: state.diffMode,
    allowImpactPreview,
    expectedFileVersions: state.expectedFileVersions,
    fileVersionManager: state.fileVersionManager,
    pathNormalizer: state.pathNormalizer,
    consumeApplyTokenOnce: state.consumeApplyTokenOnce,
    invalidateApplyTokenOnDrift: state.invalidateApplyTokenOnDrift,
    budget: {
      allowNormalization: budget.allowNormalization,
      allowLevenshtein: budget.allowLevenshtein,
      maxLevenshteinTargetLength: budget.maxLevenshteinTargetLength,
      maxMatchAttempts: budget.maxMatchAttempts
    },
    originalIntent: state.originalIntent,
    resolvedSessionId: state.resolvedSessionId,
    runTool: (ctx, tool, args) => state.deps.runTool(ctx, tool, args)
  });
  if (editFlow.blockedResponse) {
    return state.attachWorkflow(editFlow.blockedResponse);
  }
  const finalResult = editFlow.finalResult;
  const autoCorrected = editFlow.autoCorrected;
  const autoCorrectionAttempts = editFlow.autoCorrectionAttempts;

  const impactResult = await finalizeImpactReport({
    dryRun: state.dryRun,
    allowImpactPreview,
    finalResult,
    impactPromise: impactTasks.impactPromise,
    dependencyPromise: impactTasks.dependencyPromise,
    hotSpotPromise: impactTasks.hotSpotPromise,
    symbolImpactPromise: impactTasks.symbolImpactPromise,
    includeImpact: state.includeImpact,
    crossLangImpact,
    parityDegradedReasons: state.parityDegradedReasons,
    targetPath: state.targetPath,
    guardrailResult: state.guardrailResult
  });
  const symbolImpact = impactResult.symbolImpact;
  const mergedDegradedReasons = impactResult.mergedDegradedReasons;
  let impactReport = impactResult.impactReport;
  let architecturalRisk: any = impactResult.architecturalRisk;
  const architecturalWarnings: string[] = impactResult.architecturalWarnings;
  const plan = state.dryRun
    ? {
      steps: [
        {
          action: 'modify' as const,
          file: state.targetPath,
          description: state.originalIntent,
          diff: finalResult.diff
        }
      ]
    }
    : undefined;

  const failureGuidance = !finalResult.success
    ? buildFailureGuidance({
      intent: state.originalIntent,
      targetPath: state.targetPath,
      edits: state.edits,
      dryRun: state.dryRun,
      failureMessage: finalResult.message ?? finalResult.details?.message,
      autoCorrectionAttempts
    })
    : undefined;

  const successGuidance: any = {
    message: state.dryRun ? 'Change plan generated. Review the diff before applying.' : 'Changes successfully applied.',
    suggestedActions: state.dryRun
      ? [{
        id: 'change.apply',
        priority: 1,
        description: 'Apply the planned changes.',
        rationale: 'Plan completed successfully; apply to update files.',
        toolCall: {
          tool: 'change',
          args: { action: 'apply', intent: state.originalIntent, target: state.targetPath, edits: state.edits, options: { dryRun: false } }
        }
      }]
      : [{
        id: 'manage.test',
        priority: 1,
        description: 'Run tests for impacted areas.',
        rationale: 'Validate behavior after applying changes.',
        toolCall: { tool: 'manage', args: { command: 'test' } }
      }]
  };
  if (state.dryRun && state.targetPath && !state.includeImpact && shouldSuggestImpact(state.targetPath, state.guardrailResult, state.edits)) {
    successGuidance.suggestedActions.push({
      id: 'change.plan.impact',
      priority: 2,
      description: 'Generate a plan with impact analysis.',
      rationale: 'Impact analysis helps validate risk before apply.',
      toolCall: {
        tool: 'change',
        args: { action: 'plan', intent: state.originalIntent, target: state.targetPath, edits: state.edits, options: { dryRun: true, includeImpact: true } }
      }
    });
  }

  const truncatedDiff = (typeof finalResult.diff === 'string' && finalResult.diff.length > budget.maxDiffBytes)
    ? `${finalResult.diff.slice(0, budget.maxDiffBytes)}\n... (diff truncated)`
    : finalResult.diff;

  let draftPack: any = undefined;
  let applyTokenRecord: { token: string; issuedAt: number; expiresAt: number } | undefined;
  if (state.dryRun && state.targetPath) {
    const originalContent = state.reviewOriginalContent ?? '';
    const nextContent = state.reviewNextContent ?? originalContent;
    const builder = new DraftPackBuilder({
      skeletonOnly: state.constraints?.draftOptions?.skeletonOnly !== false,
      includePhantomDiff: true
    });
    draftPack = await builder.buildForChange({
      intent: state.refinedIntent,
      targetPath: state.targetPath,
      oldContent: originalContent,
      newContent: nextContent
    });
    if (state.fileVersionsSnapshot) {
      draftPack.fileVersions = state.fileVersionsSnapshot;
    }
    draftPack.workflowMeta = state.workflowMeta;
    if (state.applyPolicy.required && state.artifactManager && state.resolvedSessionId) {
      applyTokenRecord = state.artifactManager.issueApplyToken({
        sessionId: state.resolvedSessionId,
        draftId: draftPack.id,
        ttlMs: state.applyPolicy.tokenTtlMs
      });
    }
    const applyAction = successGuidance?.suggestedActions?.find((action: any) => action?.id === 'change.apply');
    if (applyAction?.toolCall?.tool === 'change' && applyAction.toolCall.args && typeof applyAction.toolCall.args === 'object') {
      applyAction.toolCall.args = {
        ...applyAction.toolCall.args,
        draftId: draftPack.id,
        ...(draftPack.fileVersions ? { fileVersions: draftPack.fileVersions } : {}),
        ...(applyTokenRecord?.token ? { applyToken: applyTokenRecord.token } : {})
      };
    }
  }

  if (!preApplyReviewComputed && (state.reviewOptions?.preApply ?? state.dryRun) && state.targetPath) {
    preApplyReview = await runReviewWithTrace({
      filePath: state.targetPath,
      content: state.reviewNextContent ?? state.reviewOriginalContent ?? '',
      oldContent: state.reviewOriginalContent,
      guardrailResult: state.guardrailResult,
      constraints: state.constraints,
      stylePack: state.sessionStylePack,
      contractImpact: crossLangImpact,
      dependencyGraph: state.dependencyGraph,
      indexStateManager: state.indexStateManager,
      strictness: state.reviewOptions?.strictness,
      traceBuilder: state.traceBuilder,
      recordSymbolicTrace,
      phase: 'pre_apply'
    });
  }

  if (!state.dryRun && finalResult.success && state.formatterMode) {
    const formatterTargets = Array.from(
      new Set(
        [
          ...(state.targetPath ? [state.targetPath] : []),
          ...state.targetFiles,
          ...state.editPaths
        ].filter((value): value is string => typeof value === 'string' && value.length > 0)
      )
    );
    formatterResult = await applyFormatterBridge({
      mode: state.formatterMode,
      filePaths: formatterTargets,
      rootPath: state.deps.resolveRootPath(),
      fileSystem: state.fileSystem,
      tool: 'change',
      rollbackAvailable: Boolean(finalResult.operation?.id)
    });
    if (formatterResult?.degradedReasons?.length) {
      const formatterDegraded = buildDegradedReasons(formatterResult.degradedReasons ?? [], { filePath: state.targetPath });
      if (formatterDegraded) {
        mergedDegradedReasons.push(...formatterDegraded);
      }
    }
    if (state.traceBuilder && formatterResult) {
      state.traceBuilder.recordEvent({
        area: 'io',
        code: 'formatter_bridge',
        data: {
          mode: state.formatterMode,
          applied: formatterResult.applied,
          skippedReason: formatterResult.skippedReason ?? null,
          degradedReasons: formatterResult.degradedReasons
        }
      });
    }
    if (formatterResult?.suggestedActions?.length) {
      successGuidance.suggestedActions = [
        ...(Array.isArray(successGuidance.suggestedActions) ? successGuidance.suggestedActions : []),
        ...formatterResult.suggestedActions
      ];
    }
  }

  let postReview: any = undefined;
  if (!state.dryRun && state.reviewOptions?.postApply && state.targetPath && finalResult.success) {
    let currentContent = '';
    try {
      currentContent = await state.fileSystem.readFile(state.targetPath);
    } catch {
      currentContent = state.reviewNextContent ?? '';
    }
    postReview = await runReviewWithTrace({
      filePath: state.targetPath,
      content: currentContent,
      oldContent: state.reviewOriginalContent,
      guardrailResult: state.guardrailResult,
      constraints: state.constraints,
      stylePack: state.sessionStylePack,
      contractImpact: crossLangImpact,
      dependencyGraph: state.dependencyGraph,
      indexStateManager: state.indexStateManager,
      strictness: state.reviewOptions?.strictness,
      traceBuilder: state.traceBuilder,
      recordSymbolicTrace,
      phase: 'post_apply'
    });
  }

  if (state.artifactManager) {
    if (draftPack) {
      state.artifactManager.store({
        id: draftPack.id,
        type: 'draft',
        createdAt: draftPack.createdAt,
        pack: draftPack,
        sessionId: state.resolvedSessionId,
        parentId: state.draftId,
        metadata: { intent: state.originalIntent }
      });
    }
    if (preApplyReview) {
      state.artifactManager.store({
        id: preApplyReview.id,
        type: 'review',
        createdAt: preApplyReview.reviewedAt,
        report: preApplyReview,
        sessionId: state.resolvedSessionId,
        parentId: draftPack?.id,
        metadata: { intent: state.originalIntent }
      });
    }
    if (postReview) {
      state.artifactManager.store({
        id: postReview.id,
        type: 'review',
        createdAt: postReview.reviewedAt,
        report: postReview,
        sessionId: state.resolvedSessionId,
        parentId: draftPack?.id,
        metadata: { intent: state.originalIntent }
      });
    }
  }

  let relatedDocs: Array<any> | undefined;
  if (!state.dryRun && finalResult.success && shouldSuggestDocs(state.constraints)) {
    const packId = state.constraints?.evidencePack ?? state.constraints?.evidencePackId ?? state.constraints?.packId;
    relatedDocs = await suggestDocUpdates(
      state.context,
      state.targetPath,
      state.edits,
      state.originalIntent,
      (ctx, tool, args) => state.deps.runTool(ctx, tool, args),
      packId ? { packId } : undefined
    );
    if (relatedDocs && successGuidance?.suggestedActions && relatedDocs.length > 0) {
      const top = relatedDocs[0];
      if (top?.filePath) {
        successGuidance.suggestedActions.push({
          id: 'document_section.preview',
          priority: 2,
          description: 'Preview related documentation section.',
          rationale: 'Docs may need updates after code changes.',
          toolCall: {
            tool: 'document_section',
            args: { action: 'preview', target: top.filePath, headingPath: top.sectionPath }
          }
        });
      }
    }
  }

  if (state.overrideDecision) {
    await AuditLog.append({
      pillar: 'change',
      operation: state.dryRun ? 'dry_run' : 'apply',
      decision: state.overrideDecision.decision,
      actor: state.overrideDecision.approval?.approvedBy,
      reason: state.overrideDecision.approval?.reason,
      ticket: state.overrideDecision.approval?.ticket,
      scope: state.overrideDecision.scope,
      requested: state.overrideDecision.requestedAllow,
      effective: state.overrideDecision.effectiveAllow,
      targetFiles: state.overrideTargets,
      result: {
        success: finalResult.success,
        status: finalResult.status,
        errorCode: finalResult.errorCode
      }
    });
  }

  return state.attachWorkflow({
    success: finalResult.success,
    message: finalResult.success ? undefined : (finalResult.message ?? finalResult.details?.message),
    operation: state.dryRun ? 'plan' : 'apply',
    targetFile: state.targetPath,
    diff: truncatedDiff,
    plan,
    draftPack,
    review: preApplyReview,
    postReview,
    impactReport,
    architecturalRisk,
    architecturalWarnings: architecturalWarnings.length > 0 ? architecturalWarnings : undefined,
    safetyChecklist: state.guardrailResult?.safetyChecklist,
    blockingErrors: state.guardrailResult?.blockingErrors,
    errorCode: state.guardrailResult?.errorCode,
    blockedReason: state.guardrailResult?.blockedReason,
    violations: state.guardrailResult?.violations,
    warnings: state.guardrailResult?.warnings,
    symbolImpact: symbolImpact || undefined,
    suggestedEdits: (symbolImpact as any)?.suggestedEdits,
    editResult: state.dryRun ? undefined : finalResult,
    transactionId: finalResult.operation?.id ?? '',
    rollbackAvailable: !state.dryRun && Boolean(finalResult.success),
    autoCorrected,
    autoCorrectionAttempts: autoCorrectionAttempts.length > 0 ? autoCorrectionAttempts : undefined,
    ...(applyTokenRecord
      ? { applyToken: applyTokenRecord.token, applyTokenExpiresAt: applyTokenRecord.expiresAt }
      : {}),
    guidance: failureGuidance ?? successGuidance,
    sessionId: state.resolvedSessionId,
    relatedDocs,
    formatter: formatterResult,
    integrity: state.integrityReport,
    degraded: (!finalResult.success && autoCorrectionAttempts.length === 0) || mergedDegradedReasons.length > 0,
    degradedReasons: mergedDegradedReasons.length > 0 ? mergedDegradedReasons : undefined,
    budget: {
      ...budget,
      used: {
        attempts: 1 + autoCorrectionAttempts.length
      }
    }
  });
}
