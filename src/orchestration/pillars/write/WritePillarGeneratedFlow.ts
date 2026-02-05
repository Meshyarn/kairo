import type { OrchestrationContext } from "../../OrchestrationContext.js";
import type { TemplateType } from "../../../generation/SimpleTemplateGenerator.js";
import type { DependencyGraph } from "../../../ast/DependencyGraph.js";
import type { IndexStateManager } from "../../../indexing/IndexStateManager.js";
import type { StylePack } from "../../../types/flow-artifacts.js";
import type { FlowArtifactManager } from "../../flow-artifact-manager.js";
import type { FileVersionManager } from "../../../engine/FileVersionManager.js";
import type { PathNormalizer } from "../../../utils/PathNormalizer.js";
import type { TraceBuilder } from "../../trace/TraceBuilder.js";
import { evaluateGuardrails, checkReviewBlock } from "./WritePillarGuardrailFlow.js";
import { resolveReviewOptions } from "./WritePillarOptionUtils.js";
import { detectFileVersionMismatch, buildFileVersionMismatchResponse } from "./WritePillarFileVersionUtils.js";

export const writeGeneratedCodeFlow = async (args: {
  filePath: string;
  content: string;
  intent: string;
  context: OrchestrationContext;
  templateType: TemplateType;
  imports?: string[];
  constraints?: any;
  sessionId?: string;
  reviewOptions?: any;
  stylePack?: StylePack;
  fileVersions?: Record<string, { expectedVersion?: number; expectedHash?: string }>;
  overrideBypass?: { integrityGuardrails?: boolean; reviewPolicy?: boolean };
  traceBuilder?: TraceBuilder;
  invalidateApplyToken?: () => void;
  consumeApplyToken?: () => any | null;
  dependencyGraph?: DependencyGraph;
  indexStateManager?: IndexStateManager;
  fileVersionManager?: FileVersionManager;
  pathNormalizer?: PathNormalizer;
  artifactManager?: FlowArtifactManager;
  runTool: (ctx: OrchestrationContext, tool: string, toolArgs: any) => Promise<any>;
  computeHash: (content: string) => { algorithm: 'xxhash' | 'sha256'; value: string };
  resolveFormatterMode: (constraints: any) => string | undefined;
  applyFormatterIfNeeded: (mode: string | undefined, filePath: string, shouldApply: boolean) => Promise<any>;
  applyFormatterOutcome: (payload: any, formatterResult: any, filePath: string) => any;
}): Promise<any> => {
  try {
    let finalContent = args.content;
    if (args.imports && args.imports.length > 0) {
      finalContent = args.imports.join('\n') + '\n\n' + args.content;
    }
    let existingContent = '';
    try {
      existingContent = await args.runTool(args.context, 'code_read', { filePath: args.filePath, view: 'full' });
    } catch {
      try {
        const tokenBlock = args.consumeApplyToken?.();
        if (tokenBlock) return tokenBlock;
        await args.runTool(args.context, 'file_write', { filePath: args.filePath, content: '' });
      } catch {
        const tokenBlock = args.consumeApplyToken?.();
        if (tokenBlock) return tokenBlock;
        await args.runTool(args.context, 'edit_apply', {
          edits: [{ filePath: args.filePath, operation: 'create', replacementString: '' }],
          dryRun: false,
          createMissingDirectories: true,
          fileVersions: args.fileVersions
        });
      }
      existingContent = '';
    }
    const guardrailResult = await evaluateGuardrails({
      targetPath: args.filePath,
      oldContent: existingContent,
      newContent: finalContent,
      constraints: args.constraints,
      dependencyGraph: args.dependencyGraph,
      indexStateManager: args.indexStateManager,
      runTool: (tool, toolArgs) => args.runTool(args.context, tool, toolArgs),
      applyMode: true
    });
    if (guardrailResult?.status === 'block') {
      if (args.overrideBypass?.integrityGuardrails) {
        // Continue despite block.
      } else {
        return {
          success: false,
          status: 'blocked',
          createdFiles: [],
          transactionId: '',
          rollbackAvailable: false,
          writeMode: 'quickGenerate',
          templateType: args.templateType,
          architecturalRisk: guardrailResult.architecturalRisk,
          architecturalWarnings: guardrailResult.architecturalWarnings,
          safetyChecklist: guardrailResult.safetyChecklist,
          blockingErrors: guardrailResult.blockingErrors,
          errorCode: guardrailResult.errorCode ?? 'ARCHITECTURE_BLOCKED',
          blockedReason: guardrailResult.blockedReason ?? 'architectural_violation',
          violations: guardrailResult.violations,
          warnings: guardrailResult.warnings,
          sessionId: args.sessionId,
          guidance: {
            message: guardrailResult.violations?.[0]?.message ?? 'Write blocked by integrity guardrails.'
          }
        };
      }
    }
    const reviewBlock = await checkReviewBlock({
      filePath: args.filePath,
      content: finalContent,
      oldContent: existingContent,
      guardrailResult,
      constraints: args.constraints,
      reviewOptions: args.reviewOptions ?? resolveReviewOptions(args.constraints?.reviewOptions, Boolean(args.sessionId)),
      stylePack: args.stylePack ?? (args.sessionId
        ? args.artifactManager?.getLatestStylePack(args.sessionId)
        : undefined),
      overrideBypass: args.overrideBypass?.reviewPolicy === true,
      traceBuilder: args.traceBuilder,
      dependencyGraph: args.dependencyGraph,
      indexStateManager: args.indexStateManager
    });
    if (reviewBlock.blocked) {
      return {
        success: false,
        status: 'blocked',
        createdFiles: [],
        transactionId: '',
        rollbackAvailable: false,
        writeMode: 'quickGenerate',
        templateType: args.templateType,
        blockedReason: 'review_blocked',
        review: reviewBlock.review,
        reviewBlockReasons: reviewBlock.reasons,
        sessionId: args.sessionId,
        guidance: {
          message: reviewBlock.message ?? 'Write blocked by review policy.',
          reviewBlockReasons: reviewBlock.reasons
        }
      };
    }
    const edit = {
      targetString: existingContent,
      replacementString: finalContent,
      indexRange: { start: 0, end: existingContent.length },
      expectedHash: existingContent ? args.computeHash(existingContent) : undefined
    };
    if (args.fileVersions && args.fileVersionManager && args.pathNormalizer) {
      const mismatch = await detectFileVersionMismatch(args.fileVersions, args.fileVersionManager, args.pathNormalizer);
      if (mismatch) {
        args.invalidateApplyToken?.();
        return buildFileVersionMismatchResponse({
          filePath: mismatch.filePath,
          intent: args.intent,
          writeMode: "quickGenerate",
          sessionId: args.sessionId
        });
      }
    }
    const tokenBlock = args.consumeApplyToken?.();
    if (tokenBlock) return tokenBlock;
    const result = await args.runTool(args.context, 'edit_transaction', {
      filePath: args.filePath,
      edits: [edit],
      dryRun: false,
      fileVersions: args.fileVersions
    });
    if (result?.errorCode === "FILE_VERSION_MISMATCH") {
      args.invalidateApplyToken?.();
      return buildFileVersionMismatchResponse({
        filePath: args.filePath,
        intent: args.intent,
        writeMode: "quickGenerate",
        sessionId: args.sessionId,
        currentFileStates: result.updatedFileStates
      });
    }
    const formatterResult = result?.success === false
      ? undefined
      : await args.applyFormatterIfNeeded(args.resolveFormatterMode(args.constraints), args.filePath, true);
    const payload = args.applyFormatterOutcome({
      success: result.success ?? true,
      status: result.success === false ? 'failure' : 'success',
      createdFiles: result.success ? [{ path: args.filePath, description: `Generated ${args.templateType} from intent: ${args.intent}` }] : [],
      transactionId: result.operation?.id || '',
      rollbackAvailable: true,
      writeMode: 'quickGenerate',
      templateType: args.templateType,
      architecturalRisk: guardrailResult?.architecturalRisk,
      architecturalWarnings: guardrailResult?.architecturalWarnings,
      safetyChecklist: guardrailResult?.safetyChecklist,
      blockingErrors: guardrailResult?.blockingErrors,
      errorCode: guardrailResult?.errorCode,
      blockedReason: guardrailResult?.blockedReason,
      violations: guardrailResult?.violations,
      warnings: guardrailResult?.warnings,
      sessionId: args.sessionId,
      guidance: {
        message: result.success ? `Generated ${args.templateType} with project style. Use 'manage undo' to rollback.` : `Generation failed: ${result.message || 'Unknown error'}`,
        suggestedActions: result.success
          ? [
              {
                id: 'read.view_full',
                priority: 1,
                description: 'Review the updated file content.',
                rationale: 'Verify the write applied as intended.',
                toolCall: { tool: 'read', args: { action: 'view_full', target: args.filePath } }
              }
            ]
          : []
      }
    }, formatterResult, args.filePath);
    return payload;
  } catch (error: any) {
    return {
      success: false,
      status: 'failure',
      createdFiles: [],
      transactionId: '',
      rollbackAvailable: false,
      writeMode: 'quickGenerate',
      sessionId: args.sessionId,
      guidance: {
        message: `Quick generate failed: ${error.message}`,
        suggestedActions: []
      }
    };
  }
};
