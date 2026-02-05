import { metrics } from '../../../utils/MetricsCollector.js';
import type { DependencyGraph } from '../../../ast/DependencyGraph.js';
import type { IndexStateManager } from '../../../indexing/IndexStateManager.js';
import { smartWriteCode, quickGenerateCode, resolveTemplateContent } from './CodeGeneration.js';
import { evaluateGuardrails, checkReviewBlock } from './WritePillarGuardrailFlow.js';
import { parseGenerationIntent } from './WritePillarGenerationUtils.js';
import { runWriteDraftFlow } from './WritePillarDraftFlow.js';
import { writeGeneratedCodeFlow } from './WritePillarGeneratedFlow.js';
import { runFastWriteFlow, runSafeWriteFlow } from './WritePillarDirectFlow.js';
import { detectFileVersionMismatch, buildFileVersionMismatchResponse } from './WritePillarFileVersionUtils.js';
import { buildDegradedReasons } from '../../DegradedReasonMapper.js';
import { looksLikePath, toPascalCase } from './WritePillarPathUtils.js';
export async function executeWriteFlow(state: Record<string, any>): Promise<any> {
  const draftResponse = await runWriteDraftFlow({
    dryRun: state.dryRun,
    resolvedPath: state.resolvedPath,
    originalIntent: state.originalIntent,
    refinement: state.refinement,
    constraints: state.constraints,
    context: state.context,
    smartWrite: state.smartWrite,
    quickGenerate: state.quickGenerate,
    hasExplicitContent: state.hasExplicitContent,
    content: state.content,
    template: state.template,
    styleReference: state.styleReference,
    draftOptions: state.draftOptions,
    applyPolicy: state.applyPolicy,
    artifactManager: state.artifactManager,
    resolvedSessionId: state.resolvedSessionId,
    draftId: state.draftId,
    reviewOptions: state.reviewOptions,
    workflowMeta: state.workflowMeta,
    sessionStylePack: state.sessionStylePack,
    fileVersionManager: state.fileVersionManager,
    pathNormalizer: state.pathNormalizer,
    dependencyGraph: state.deps.registry.getMetadata("dependencyGraph") as DependencyGraph | undefined,
    indexStateManager: state.deps.registry.getMetadata("indexStateManager") as IndexStateManager | undefined,
    traceBuilder: state.traceBuilder,
    runTool: (ctx, tool, args) => state.deps.runTool(ctx, tool, args),
    attachResponse: state.attachResponse
  });
  if (draftResponse) {
    return draftResponse;
  }

  const fileVersions = state.expectedFileVersions;

  if (state.smartWrite && !state.hasExplicitContent) {
    const stopSmartWrite = metrics.startTimer("write.smart_write_ms");
    try {
      const generated = await smartWriteCode(
        state.resolvedPath,
        state.originalIntent,
        state.constraints,
        state.context,
        (ctx, tool, args) => state.deps.runTool(ctx, tool, args),
        (i, p) => parseGenerationIntent(i, p),
        state.styleReference
      );
      stopSmartWrite();

      if (generated) {
        state.content = generated.code;
        const result = await writeGeneratedCodeFlow({
          filePath: state.resolvedPath,
          content: state.content,
          intent: state.originalIntent,
          context: state.context,
          templateType: generated.templateType,
          imports: generated.imports,
          constraints: state.constraints,
          sessionId: state.resolvedSessionId,
          reviewOptions: state.reviewOptions,
          stylePack: state.sessionStylePack,
          fileVersions,
          overrideBypass: { integrityGuardrails: state.bypassIntegrityGuardrails, reviewPolicy: state.bypassReviewBlock },
          traceBuilder: state.traceBuilder,
          invalidateApplyToken: state.invalidateApplyTokenOnDrift,
          consumeApplyToken: state.consumeApplyTokenOnce,
          dependencyGraph: state.deps.registry.getMetadata("dependencyGraph") as DependencyGraph | undefined,
          indexStateManager: state.deps.registry.getMetadata("indexStateManager") as IndexStateManager | undefined,
          fileVersionManager: state.fileVersionManager,
          pathNormalizer: state.pathNormalizer,
          artifactManager: state.artifactManager,
          runTool: (ctx, tool, args) => state.deps.runTool(ctx, tool, args),
          computeHash: (value) => state.deps.computeHash(value),
          resolveFormatterMode: (value) => state.deps.resolveFormatterMode(value),
          applyFormatterIfNeeded: (mode, filePath, shouldApply) =>
            state.deps.applyFormatterIfNeeded(mode, filePath, shouldApply),
          applyFormatterOutcome: (payload, formatterResult, filePath) =>
            state.deps.applyFormatterOutcome(payload, formatterResult, filePath)
        });
        return state.attachResponse(result);
      }
    } catch (error: any) {
      stopSmartWrite();
      console.warn(`Smart write failed: ${error.message}, falling back to quickGenerate`);
    }
  }

  if ((state.quickGenerate || state.smartWrite) && !state.hasExplicitContent) {
    const stopGenerate = metrics.startTimer("write.quick_generate_ms");
    try {
      const generated = await quickGenerateCode(state.resolvedPath, state.originalIntent, (i, p) => parseGenerationIntent(i, p));
      stopGenerate();
      if (generated) {
        state.content = generated.code;
        const result = await writeGeneratedCodeFlow({
          filePath: state.resolvedPath,
          content: state.content,
          intent: state.originalIntent,
          context: state.context,
          templateType: generated.templateType,
          constraints: state.constraints,
          sessionId: state.resolvedSessionId,
          reviewOptions: state.reviewOptions,
          stylePack: state.sessionStylePack,
          fileVersions,
          overrideBypass: { integrityGuardrails: state.bypassIntegrityGuardrails, reviewPolicy: state.bypassReviewBlock },
          traceBuilder: state.traceBuilder,
          invalidateApplyToken: state.invalidateApplyTokenOnDrift,
          consumeApplyToken: state.consumeApplyTokenOnce,
          dependencyGraph: state.deps.registry.getMetadata("dependencyGraph") as DependencyGraph | undefined,
          indexStateManager: state.deps.registry.getMetadata("indexStateManager") as IndexStateManager | undefined,
          fileVersionManager: state.fileVersionManager,
          pathNormalizer: state.pathNormalizer,
          artifactManager: state.artifactManager,
          runTool: (ctx, tool, args) => state.deps.runTool(ctx, tool, args),
          computeHash: (value) => state.deps.computeHash(value),
          resolveFormatterMode: (value) => state.deps.resolveFormatterMode(value),
          applyFormatterIfNeeded: (mode, filePath, shouldApply) =>
            state.deps.applyFormatterIfNeeded(mode, filePath, shouldApply),
          applyFormatterOutcome: (payload, formatterResult, filePath) =>
            state.deps.applyFormatterOutcome(payload, formatterResult, filePath)
        });
        return state.attachResponse(result);
      }
    } catch (error: any) {
      stopGenerate();
      console.warn(`Quick generate failed: ${error.message}`);
    }
  }

  if (state.hasExplicitContent) {
    const safeWriteResponse = await runSafeWriteFlow({
      hasExplicitContent: state.hasExplicitContent,
      safeWrite: state.safeWrite,
      context: state.context,
      resolvedPath: state.resolvedPath,
      content: state.content,
      constraints: state.constraints,
      reviewOptions: state.reviewOptions,
      sessionStylePack: state.sessionStylePack,
      fileVersions,
      fileVersionManager: state.fileVersionManager,
      pathNormalizer: state.pathNormalizer,
      formatterMode: state.formatterMode,
      traceBuilder: state.traceBuilder,
      originalIntent: state.originalIntent,
      resolvedSessionId: state.resolvedSessionId,
      bypassIntegrityGuardrails: state.bypassIntegrityGuardrails,
      bypassReviewBlock: state.bypassReviewBlock,
      workflowWarnings: state.workflowWarnings,
      consumeApplyTokenOnce: state.consumeApplyTokenOnce,
      invalidateApplyTokenOnDrift: state.invalidateApplyTokenOnDrift,
      runTool: (ctx, tool, args) => state.deps.runTool(ctx, tool, args),
      computeHash: (value) => state.deps.computeHash(value),
      applyFormatterIfNeeded: (mode, filePath, shouldApply) =>
        state.deps.applyFormatterIfNeeded(mode, filePath, shouldApply),
      applyFormatterOutcome: (payload, formatterResult, filePath) =>
        state.deps.applyFormatterOutcome(payload, formatterResult, filePath),
      attachResponse: state.attachResponse,
      dependencyGraph: state.deps.registry.getMetadata("dependencyGraph") as DependencyGraph | undefined,
      indexStateManager: state.deps.registry.getMetadata("indexStateManager") as IndexStateManager | undefined
    });
    if (safeWriteResponse) {
      return safeWriteResponse;
    }

    const fastWriteResponse = await runFastWriteFlow({
      hasExplicitContent: state.hasExplicitContent,
      safeWrite: state.safeWrite,
      context: state.context,
      resolvedPath: state.resolvedPath,
      content: state.content,
      constraints: state.constraints,
      reviewOptions: state.reviewOptions,
      sessionStylePack: state.sessionStylePack,
      fileVersions,
      fileVersionManager: state.fileVersionManager,
      pathNormalizer: state.pathNormalizer,
      formatterMode: state.formatterMode,
      traceBuilder: state.traceBuilder,
      originalIntent: state.originalIntent,
      resolvedSessionId: state.resolvedSessionId,
      bypassIntegrityGuardrails: state.bypassIntegrityGuardrails,
      bypassReviewBlock: state.bypassReviewBlock,
      workflowWarnings: state.workflowWarnings,
      consumeApplyTokenOnce: state.consumeApplyTokenOnce,
      invalidateApplyTokenOnDrift: state.invalidateApplyTokenOnDrift,
      runTool: (ctx, tool, args) => state.deps.runTool(ctx, tool, args),
      applyFormatterIfNeeded: (mode, filePath, shouldApply) =>
        state.deps.applyFormatterIfNeeded(mode, filePath, shouldApply),
      applyFormatterOutcome: (payload, formatterResult, filePath) =>
        state.deps.applyFormatterOutcome(payload, formatterResult, filePath),
      attachResponse: state.attachResponse,
      dependencyGraph: state.deps.registry.getMetadata("dependencyGraph") as DependencyGraph | undefined,
      indexStateManager: state.deps.registry.getMetadata("indexStateManager") as IndexStateManager | undefined
    });
    if (fastWriteResponse) {
      return fastWriteResponse;
    }
  }

  let existingContent: string | null = null;
  try {
    existingContent = await state.deps.runTool(state.context, 'code_read', { filePath: state.resolvedPath, view: 'full' });
  } catch {
    existingContent = null;
  }

  if (state.content === '' && state.template) {
    const templated = await resolveTemplateContent(
      state.template,
      state.resolvedPath,
      state.originalIntent,
      state.context,
      (ctx, tool, args) => state.deps.runTool(ctx, tool, args),
      (v) => toPascalCase(v),
      (v) => looksLikePath(v)
    );
    if (typeof templated === 'string') {
      state.content = templated;
    }
  }

  if (state.content === '' && existingContent === null) {
    const tokenBlock = state.consumeApplyTokenOnce();
    if (tokenBlock) {
      return state.attachResponse(tokenBlock);
    }
    const created = await state.deps.runTool(state.context, 'edit_apply', {
      edits: [{ filePath: state.resolvedPath, operation: 'create', replacementString: '' }],
      dryRun: false,
      createMissingDirectories: true,
      fileVersions
    });
    if (created?.errorCode === "FILE_VERSION_MISMATCH") {
      state.invalidateApplyTokenOnDrift();
      return state.attachResponse(buildFileVersionMismatchResponse({
        filePath: state.resolvedPath,
        intent: state.originalIntent,
        writeMode: "safe",
        sessionId: state.resolvedSessionId,
        currentFileStates: created.updatedFileStates
      }));
    }
    const formatterResult = created?.success === false
      ? undefined
      : await state.deps.applyFormatterIfNeeded(state.formatterMode, state.resolvedPath, true);
    const payload = state.deps.applyFormatterOutcome({
      success: created?.success ?? true,
      status: created?.success === false ? "failure" : "success",
      createdFiles: [{ path: state.resolvedPath, description: `Created from intent: ${state.originalIntent}` }],
      transactionId: created?.operation?.id ?? "",
      guidance: {
        message: created?.success === false ? 'Empty file create failed.' : 'Empty file created.',
        suggestedActions: created?.success === false
          ? []
          : [
            {
              id: 'read.view_full',
              priority: 1,
              description: 'Review the updated file content.',
              rationale: 'Verify the write applied as intended.',
              toolCall: { tool: 'read', args: { action: 'view_full', target: state.resolvedPath } }
            }
          ]
      }
    }, formatterResult, state.resolvedPath);
    return state.attachResponse(payload);
  }

  const edit = existingContent === null
    ? { targetString: '', replacementString: state.content, insertMode: 'at' as const, insertLineRange: { start: 1 } }
    : { targetString: existingContent, replacementString: state.content };

  const guardrailResult = await evaluateGuardrails({
    targetPath: state.resolvedPath,
    oldContent: existingContent ?? "",
    newContent: state.content,
    constraints: state.constraints,
    dependencyGraph: state.deps.registry.getMetadata("dependencyGraph") as DependencyGraph | undefined,
    indexStateManager: state.deps.registry.getMetadata("indexStateManager") as IndexStateManager | undefined,
    runTool: (tool, args) => state.deps.runTool(state.context, tool, args),
    applyMode: true
  });
  if (guardrailResult?.status === 'block') {
    if (state.bypassIntegrityGuardrails) {
      state.workflowWarnings.push("Override bypassed integrity guardrails blocking for this apply.");
    } else {
      return state.attachResponse({
        success: false,
        status: 'blocked',
        createdFiles: [],
        transactionId: '',
        rollbackAvailable: false,
        writeMode: 'safe',
        architecturalRisk: guardrailResult.architecturalRisk,
        architecturalWarnings: guardrailResult.architecturalWarnings,
        safetyChecklist: guardrailResult.safetyChecklist,
        blockingErrors: guardrailResult.blockingErrors,
        errorCode: guardrailResult.errorCode ?? 'ARCHITECTURE_BLOCKED',
        blockedReason: guardrailResult.blockedReason ?? 'architectural_violation',
        violations: guardrailResult.violations,
        warnings: guardrailResult.warnings,
        guidance: {
          message: guardrailResult.violations?.[0]?.message ?? 'Write blocked by integrity guardrails.'
        }
      });
    }
  }
  const reviewBlock = await checkReviewBlock({
    filePath: state.resolvedPath,
    content: state.content,
    oldContent: existingContent ?? '',
    guardrailResult,
    constraints: state.constraints,
    reviewOptions: state.reviewOptions,
    stylePack: state.sessionStylePack,
    overrideBypass: state.bypassReviewBlock,
    traceBuilder: state.traceBuilder,
    dependencyGraph: state.deps.registry.getMetadata("dependencyGraph") as DependencyGraph | undefined,
    indexStateManager: state.deps.registry.getMetadata("indexStateManager") as IndexStateManager | undefined
  });
  if (reviewBlock.blocked) {
    return state.attachResponse({
      success: false,
      status: 'blocked',
      createdFiles: [],
      transactionId: '',
      rollbackAvailable: false,
      writeMode: 'safe',
      blockedReason: 'review_blocked',
      review: reviewBlock.review,
      reviewBlockReasons: reviewBlock.reasons,
      guidance: {
        message: reviewBlock.message ?? 'Write blocked by review policy.',
        reviewBlockReasons: reviewBlock.reasons
      }
    });
  }

  if (fileVersions && state.fileVersionManager && state.pathNormalizer) {
    const mismatch = await detectFileVersionMismatch(fileVersions, state.fileVersionManager, state.pathNormalizer);
    if (mismatch) {
      state.invalidateApplyTokenOnDrift();
      return state.attachResponse(buildFileVersionMismatchResponse({
        filePath: mismatch.filePath,
        intent: state.originalIntent,
        writeMode: "safe",
        sessionId: state.resolvedSessionId
      }));
    }
  }

  const tokenBlock = state.consumeApplyTokenOnce();
  if (tokenBlock) {
    return state.attachResponse(tokenBlock);
  }

  if (existingContent === null) {
    const created = await state.deps.runTool(state.context, 'edit_apply', {
      edits: [{ filePath: state.resolvedPath, operation: 'create', replacementString: state.content }],
      dryRun: false,
      createMissingDirectories: true,
      fileVersions
    });
    if (created?.errorCode === "FILE_VERSION_MISMATCH") {
      state.invalidateApplyTokenOnDrift();
      return state.attachResponse(buildFileVersionMismatchResponse({
        filePath: state.resolvedPath,
        intent: state.originalIntent,
        writeMode: "safe",
        sessionId: state.resolvedSessionId,
        currentFileStates: created.updatedFileStates
      }));
    }
    const reasonCodes = Array.isArray(guardrailResult?.blockingErrors)
      ? guardrailResult.blockingErrors
      : undefined;
    const degradedReasons = buildDegradedReasons(reasonCodes, { filePath: state.resolvedPath });
    const formatterResult = created?.success === false
      ? undefined
      : await state.deps.applyFormatterIfNeeded(state.formatterMode, state.resolvedPath, true);
    const payload = state.deps.applyFormatterOutcome({
      success: created?.success ?? true,
      status: created?.success === false ? 'failure' : 'success',
      createdFiles: [{ path: state.resolvedPath, description: `Created from intent: ${state.originalIntent}` }],
      transactionId: created?.operation?.id ?? '',
      architecturalRisk: guardrailResult?.architecturalRisk,
      architecturalWarnings: guardrailResult?.architecturalWarnings,
      safetyChecklist: guardrailResult?.safetyChecklist,
      blockingErrors: guardrailResult?.blockingErrors,
      errorCode: guardrailResult?.errorCode,
      blockedReason: guardrailResult?.blockedReason,
      violations: guardrailResult?.violations,
      warnings: guardrailResult?.warnings,
      degraded: Boolean(guardrailResult?.blockingErrors?.length),
      degradedReasons,
      guidance: {
        message: created?.success === false ? 'File create failed.' : 'File created.',
        suggestedActions: created?.success === false
          ? []
          : [
            {
              id: 'read.view_full',
              priority: 1,
              description: 'Review the updated file content.',
              rationale: 'Verify the write applied as intended.',
              toolCall: { tool: 'read', args: { action: 'view_full', target: state.resolvedPath } }
            }
          ]
      }
    }, formatterResult, state.resolvedPath);
    return state.attachResponse(payload);
  }
  const editResult = await state.deps.runTool(state.context, 'edit_transaction', {
    filePath: state.resolvedPath,
    edits: [edit],
    dryRun: false,
    fileVersions
  });

  if (editResult?.errorCode === "FILE_VERSION_MISMATCH") {
    state.invalidateApplyTokenOnDrift();
    return state.attachResponse(buildFileVersionMismatchResponse({
      filePath: state.resolvedPath,
      intent: state.originalIntent,
      writeMode: "safe",
      sessionId: state.resolvedSessionId,
      currentFileStates: editResult.updatedFileStates
    }));
  }

  const reasonCodes = Array.isArray(guardrailResult?.blockingErrors)
    ? guardrailResult.blockingErrors
    : undefined;
  const degradedReasons = buildDegradedReasons(reasonCodes, { filePath: state.resolvedPath });

  const formatterResult = editResult?.success === false
    ? undefined
    : await state.deps.applyFormatterIfNeeded(state.formatterMode, state.resolvedPath, true);
  if (state.traceBuilder && formatterResult) {
    state.traceBuilder.recordEvent({
      area: "io",
      code: "formatter_bridge",
      data: {
        mode: state.formatterMode,
        applied: formatterResult.applied,
        skippedReason: formatterResult.skippedReason ?? null,
        degradedReasons: formatterResult.degradedReasons
      }
    });
  }
  const payload = state.deps.applyFormatterOutcome({
    success: editResult.success ?? true,
    status: editResult.success === false ? 'failure' : 'success',
    createdFiles: [{ path: state.resolvedPath, description: `Written from intent: ${state.originalIntent}` }],
    transactionId: editResult.operation?.id ?? '',
    architecturalRisk: guardrailResult?.architecturalRisk,
    architecturalWarnings: guardrailResult?.architecturalWarnings,
    safetyChecklist: guardrailResult?.safetyChecklist,
    blockingErrors: guardrailResult?.blockingErrors,
    errorCode: guardrailResult?.errorCode,
    blockedReason: guardrailResult?.blockedReason,
    violations: guardrailResult?.violations,
    warnings: guardrailResult?.warnings,
    degraded: Boolean(guardrailResult?.blockingErrors?.length),
    degradedReasons,
    guidance: {
      message: editResult.success ? 'File written.' : 'File write failed.',
      suggestedActions: editResult.success
        ? [
          {
            id: 'read.view_full',
            priority: 1,
            description: 'Review the updated file content.',
            rationale: 'Verify the write applied as intended.',
            toolCall: { tool: 'read', args: { action: 'view_full', target: state.resolvedPath } }
          }
        ]
        : []
    }
  }, formatterResult, state.resolvedPath);
  return state.attachResponse(payload);
}
