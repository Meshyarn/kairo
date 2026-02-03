import type { OrchestrationContext } from "../../OrchestrationContext.js";
import type { DependencyGraph } from "../../../ast/DependencyGraph.js";
import type { IndexStateManager } from "../../../indexing/IndexStateManager.js";
import type { StylePack } from "../../../types/flow-artifacts.js";
import type { FileVersionManager } from "../../../engine/FileVersionManager.js";
import type { PathNormalizer } from "../../../utils/PathNormalizer.js";
import type { TraceBuilder } from "../../trace/TraceBuilder.js";
import { metrics } from "../../../utils/MetricsCollector.js";
import { evaluateGuardrails, checkReviewBlock } from "./WritePillarGuardrailFlow.js";
import { evaluateIntegrityGuardrailBlock } from "../shared/IntegrityGuardrailDecision.js";
import { buildFileVersionMismatchResponse, detectFileVersionMismatch } from "./WritePillarFileVersionUtils.js";

export const runSafeWriteFlow = async (args: {
  hasExplicitContent: boolean;
  safeWrite: boolean;
  context: OrchestrationContext;
  resolvedPath: string;
  content: string;
  constraints: any;
  reviewOptions: any;
  sessionStylePack?: StylePack;
  fileVersions?: Record<string, { expectedVersion?: number; expectedHash?: string }>;
  fileVersionManager?: FileVersionManager;
  pathNormalizer?: PathNormalizer;
  formatterMode: string | undefined;
  traceBuilder?: TraceBuilder;
  originalIntent: string;
  resolvedSessionId?: string;
  bypassIntegrityGuardrails: boolean;
  bypassReviewBlock: boolean;
  workflowWarnings: string[];
  consumeApplyTokenOnce: () => any | null;
  invalidateApplyTokenOnDrift: () => void;
  runTool: (ctx: OrchestrationContext, tool: string, args: any) => Promise<any>;
  computeHash: (content: string) => { algorithm: 'xxhash' | 'sha256'; value: string };
  applyFormatterIfNeeded: (mode: string | undefined, filePath: string, shouldApply: boolean) => Promise<any>;
  applyFormatterOutcome: (payload: any, formatterResult: any, filePath: string) => any;
  attachResponse: <T extends Record<string, any>>(payload: T) => any;
  dependencyGraph?: DependencyGraph;
  indexStateManager?: IndexStateManager;
}): Promise<any | null> => {
  if (!args.hasExplicitContent || !args.safeWrite) return null;
  const stopSafePatch = metrics.startTimer("write.safe_patch_ms");
  try {
    let existingContent = '';
    try {
      existingContent = await args.runTool(args.context, 'code_read', { filePath: args.resolvedPath, view: 'full' });
    } catch {
      try {
        const tokenBlock = args.consumeApplyTokenOnce();
        if (tokenBlock) {
          stopSafePatch();
          return args.attachResponse(tokenBlock);
        }
        await args.runTool(args.context, 'file_write', { filePath: args.resolvedPath, content: '' });
      } catch {
        const tokenBlock = args.consumeApplyTokenOnce();
        if (tokenBlock) {
          stopSafePatch();
          return args.attachResponse(tokenBlock);
        }
        await args.runTool(args.context, 'edit_apply', {
          edits: [{ filePath: args.resolvedPath, operation: 'create', replacementString: '' }],
          dryRun: false,
          createMissingDirectories: true,
          fileVersions: args.fileVersions
        });
      }
      existingContent = '';
    }

    let guardrailResult = await evaluateGuardrails({
      targetPath: args.resolvedPath,
      oldContent: existingContent,
      newContent: args.content,
      constraints: args.constraints,
      dependencyGraph: args.dependencyGraph,
      indexStateManager: args.indexStateManager,
      runTool: (tool, toolArgs) => args.runTool(args.context, tool, toolArgs),
      applyMode: true
    });
    const guardrailDecision = evaluateIntegrityGuardrailBlock({
      guardrailResult,
      dryRun: false,
      bypass: args.bypassIntegrityGuardrails,
      workflowWarnings: args.workflowWarnings,
      warningMessage: "Override bypassed integrity guardrails blocking for this apply.",
      downgradeOnBypass: false
    });
    guardrailResult = guardrailDecision.guardrailResult;
    if (args.traceBuilder) {
      args.traceBuilder.recordEvent({
        area: "guardrails",
        code: "integrity_guardrails",
        data: { blocked: guardrailDecision.blocked, bypassed: args.bypassIntegrityGuardrails }
      });
    }
    if (guardrailDecision.blocked) {
      if (args.traceBuilder) {
        args.traceBuilder.recordSkip("integrity_guardrails", "guardrail_blocked", "integrity guardrails blocked write");
      }
      stopSafePatch();
      return args.attachResponse({
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
    const reviewBlock = await checkReviewBlock({
      filePath: args.resolvedPath,
      content: args.content,
      oldContent: existingContent,
      guardrailResult,
      constraints: args.constraints,
      reviewOptions: args.reviewOptions,
      stylePack: args.sessionStylePack,
      overrideBypass: args.bypassReviewBlock,
      traceBuilder: args.traceBuilder,
      dependencyGraph: args.dependencyGraph,
      indexStateManager: args.indexStateManager
    });
    if (reviewBlock.blocked) {
      stopSafePatch();
      return args.attachResponse({
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

    const edit = {
      targetString: existingContent,
      replacementString: args.content,
      indexRange: { start: 0, end: existingContent.length },
      expectedHash: existingContent ? args.computeHash(existingContent) : undefined
    };

    if (args.fileVersions && args.fileVersionManager && args.pathNormalizer) {
      const mismatch = await detectFileVersionMismatch(args.fileVersions, args.fileVersionManager, args.pathNormalizer);
      if (mismatch) {
        stopSafePatch();
        args.invalidateApplyTokenOnDrift();
        return args.attachResponse(buildFileVersionMismatchResponse({
          filePath: mismatch.filePath,
          intent: args.originalIntent,
          writeMode: "safe",
          sessionId: args.resolvedSessionId
        }));
      }
    }

    const tokenBlock = args.consumeApplyTokenOnce();
    if (tokenBlock) {
      stopSafePatch();
      return args.attachResponse(tokenBlock);
    }
    const result = await args.runTool(args.context, 'edit_transaction', {
      filePath: args.resolvedPath,
      edits: [edit],
      dryRun: false,
      fileVersions: args.fileVersions
    });

    stopSafePatch();

    if (result?.errorCode === "FILE_VERSION_MISMATCH") {
      args.invalidateApplyTokenOnDrift();
      return args.attachResponse(buildFileVersionMismatchResponse({
        filePath: args.resolvedPath,
        intent: args.originalIntent,
        writeMode: "safe",
        sessionId: args.resolvedSessionId,
        currentFileStates: result.updatedFileStates
      }));
    }

    const formatterResult = result?.success === false
      ? undefined
      : await args.applyFormatterIfNeeded(args.formatterMode, args.resolvedPath, true);
    if (args.traceBuilder && formatterResult) {
      args.traceBuilder.recordEvent({
        area: "io",
        code: "formatter_bridge",
        data: {
          mode: args.formatterMode,
          applied: formatterResult.applied,
          skippedReason: formatterResult.skippedReason ?? null,
          degradedReasons: formatterResult.degradedReasons
        }
      });
    }
    const payload = args.applyFormatterOutcome({
      success: result.success ?? true,
      status: result.success === false ? 'failure' : 'success',
      createdFiles: result.success ? [{ path: args.resolvedPath, description: `Written (safe mode) from intent: ${args.originalIntent}` }] : [],
      transactionId: result.operation?.id || '',
      rollbackAvailable: true,
      writeMode: 'safe',
      architecturalRisk: guardrailResult?.architecturalRisk,
      architecturalWarnings: guardrailResult?.architecturalWarnings,
      safetyChecklist: guardrailResult?.safetyChecklist,
      blockingErrors: guardrailResult?.blockingErrors,
      errorCode: guardrailResult?.errorCode,
      blockedReason: guardrailResult?.blockedReason,
      violations: guardrailResult?.violations,
      warnings: guardrailResult?.warnings,
      guidance: {
        message: result.success ? 'File written with undo support.' : `Write failed: ${result.message || 'Unknown error'}`,
        suggestedActions: result.success
          ? [
              {
                id: 'read.view_full',
                priority: 1,
                description: 'Review the updated file content.',
                rationale: 'Verify the write applied as intended.',
                toolCall: { tool: 'read', args: { action: 'view_full', target: args.resolvedPath } }
              }
            ]
          : []
      }
    }, formatterResult, args.resolvedPath);
    return args.attachResponse(payload);
  } catch (error: any) {
    stopSafePatch();
    return args.attachResponse({
      success: false,
      status: 'failure',
      createdFiles: [],
      transactionId: '',
      rollbackAvailable: false,
      writeMode: 'safe',
      guidance: { message: `Safe write failed: ${error.message}`, suggestedActions: [] }
    });
  }
};

export const runFastWriteFlow = async (args: {
  hasExplicitContent: boolean;
  safeWrite: boolean;
  context: OrchestrationContext;
  resolvedPath: string;
  content: string;
  constraints: any;
  reviewOptions: any;
  sessionStylePack?: StylePack;
  fileVersions?: Record<string, { expectedVersion?: number; expectedHash?: string }>;
  fileVersionManager?: FileVersionManager;
  pathNormalizer?: PathNormalizer;
  formatterMode: string | undefined;
  traceBuilder?: TraceBuilder;
  originalIntent: string;
  resolvedSessionId?: string;
  bypassIntegrityGuardrails: boolean;
  bypassReviewBlock: boolean;
  workflowWarnings: string[];
  consumeApplyTokenOnce: () => any | null;
  invalidateApplyTokenOnDrift: () => void;
  runTool: (ctx: OrchestrationContext, tool: string, args: any) => Promise<any>;
  applyFormatterIfNeeded: (mode: string | undefined, filePath: string, shouldApply: boolean) => Promise<any>;
  applyFormatterOutcome: (payload: any, formatterResult: any, filePath: string) => any;
  attachResponse: <T extends Record<string, any>>(payload: T) => any;
  dependencyGraph?: DependencyGraph;
  indexStateManager?: IndexStateManager;
}): Promise<any | null> => {
  if (!args.hasExplicitContent || args.safeWrite) return null;
  let existingContent = '';
  try {
    existingContent = await args.runTool(args.context, 'code_read', { filePath: args.resolvedPath, view: 'full' });
  } catch {
    existingContent = '';
  }
  let guardrailResult = await evaluateGuardrails({
    targetPath: args.resolvedPath,
    oldContent: existingContent,
    newContent: args.content,
    constraints: args.constraints,
    dependencyGraph: args.dependencyGraph,
    indexStateManager: args.indexStateManager,
    runTool: (tool, toolArgs) => args.runTool(args.context, tool, toolArgs),
    applyMode: true
  });
  const guardrailDecision = evaluateIntegrityGuardrailBlock({
    guardrailResult,
    dryRun: false,
    bypass: args.bypassIntegrityGuardrails,
    workflowWarnings: args.workflowWarnings,
    warningMessage: "Override bypassed integrity guardrails blocking for this apply.",
    downgradeOnBypass: false
  });
  guardrailResult = guardrailDecision.guardrailResult;
  if (args.traceBuilder) {
    args.traceBuilder.recordEvent({
      area: "guardrails",
      code: "integrity_guardrails",
      data: { blocked: guardrailDecision.blocked, bypassed: args.bypassIntegrityGuardrails }
    });
  }
  if (guardrailDecision.blocked) {
    if (args.traceBuilder) {
      args.traceBuilder.recordSkip("integrity_guardrails", "guardrail_blocked", "integrity guardrails blocked write");
    }
    return args.attachResponse({
      success: false,
      status: 'blocked',
      createdFiles: [],
      transactionId: '',
      rollbackAvailable: false,
      writeMode: 'fast',
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
  const reviewBlock = await checkReviewBlock({
    filePath: args.resolvedPath,
    content: args.content,
    oldContent: existingContent,
    guardrailResult,
    constraints: args.constraints,
    reviewOptions: args.reviewOptions,
    stylePack: args.sessionStylePack,
    overrideBypass: args.bypassReviewBlock,
    traceBuilder: args.traceBuilder,
    dependencyGraph: args.dependencyGraph,
    indexStateManager: args.indexStateManager
  });
  if (reviewBlock.blocked) {
    return args.attachResponse({
      success: false,
      status: 'blocked',
      createdFiles: [],
      transactionId: '',
      rollbackAvailable: false,
      writeMode: 'fast',
      blockedReason: 'review_blocked',
      review: reviewBlock.review,
      reviewBlockReasons: reviewBlock.reasons,
      guidance: {
        message: reviewBlock.message ?? 'Write blocked by review policy.',
        reviewBlockReasons: reviewBlock.reasons
      }
    });
  }

  try {
    const tokenBlock = args.consumeApplyTokenOnce();
    if (tokenBlock) {
      return args.attachResponse(tokenBlock);
    }
    await args.runTool(args.context, 'file_write', { filePath: args.resolvedPath, content: args.content });
  } catch {
    const tokenBlock = args.consumeApplyTokenOnce();
    if (tokenBlock) {
      return args.attachResponse(tokenBlock);
    }
    const fallback = await args.runTool(args.context, 'edit_apply', {
      edits: [{ filePath: args.resolvedPath, operation: 'create', replacementString: args.content }],
      dryRun: false,
      createMissingDirectories: true,
      fileVersions: args.fileVersions
    });
    if (fallback?.errorCode === "FILE_VERSION_MISMATCH") {
      args.invalidateApplyTokenOnDrift();
      return args.attachResponse(buildFileVersionMismatchResponse({
        filePath: args.resolvedPath,
        intent: args.originalIntent,
        writeMode: "fast",
        sessionId: args.resolvedSessionId,
        currentFileStates: fallback.updatedFileStates
      }));
    }
  }

  const formatterResult = await args.applyFormatterIfNeeded(args.formatterMode, args.resolvedPath, false);
  if (args.traceBuilder && formatterResult) {
    args.traceBuilder.recordEvent({
      area: "io",
      code: "formatter_bridge",
      data: {
        mode: args.formatterMode,
        applied: formatterResult.applied,
        skippedReason: formatterResult.skippedReason ?? null,
        degradedReasons: formatterResult.degradedReasons
      }
    });
  }
  const payload = args.applyFormatterOutcome({
    success: true,
    status: 'success',
    createdFiles: [{ path: args.resolvedPath, description: `Written from intent: ${args.originalIntent}` }],
    transactionId: '',
    rollbackAvailable: false,
    writeMode: 'fast',
    architecturalRisk: guardrailResult?.architecturalRisk,
    architecturalWarnings: guardrailResult?.architecturalWarnings,
    safetyChecklist: guardrailResult?.safetyChecklist,
    blockingErrors: guardrailResult?.blockingErrors,
    errorCode: guardrailResult?.errorCode,
    blockedReason: guardrailResult?.blockedReason,
    violations: guardrailResult?.violations,
    warnings: guardrailResult?.warnings,
    guidance: {
      message: 'File written (fast mode, no undo).',
      suggestedActions: [
        {
          id: 'read.view_full',
          priority: 1,
          description: 'Review the updated file content.',
          rationale: 'Verify the write applied as intended.',
          toolCall: { tool: 'read', args: { action: 'view_full', target: args.resolvedPath } }
        }
      ]
    }
  }, formatterResult, args.resolvedPath);
  return args.attachResponse(payload);
};
