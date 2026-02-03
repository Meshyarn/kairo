import type { OrchestrationContext } from "../../OrchestrationContext.js";
import type { TemplateType } from "../../../generation/SimpleTemplateGenerator.js";
import type { DependencyGraph } from "../../../ast/DependencyGraph.js";
import type { IndexStateManager } from "../../../indexing/IndexStateManager.js";
import type { DraftPack, StylePack, WorkflowMeta } from "../../../types/flow-artifacts.js";
import type { FlowArtifactManager } from "../../flow-artifact-manager.js";
import type { FileVersionManager } from "../../../engine/FileVersionManager.js";
import type { PathNormalizer } from "../../../utils/PathNormalizer.js";
import type { TraceBuilder } from "../../trace/TraceBuilder.js";
import { DraftPackBuilder } from "../../../generation/draft-pack-builder.js";
import { ReviewReportBuilder } from "../../../generation/review-report-builder.js";
import { smartWriteCode, quickGenerateCode, resolveTemplateContent } from "./CodeGeneration.js";
import { parseGenerationIntent } from "./WritePillarGenerationUtils.js";
import { toPascalCase, looksLikePath } from "./WritePillarPathUtils.js";
import { buildFileVersionsSnapshot } from "./WritePillarFileVersionUtils.js";

export const runWriteDraftFlow = async (args: {
  dryRun: boolean;
  resolvedPath: string;
  originalIntent: string;
  refinement?: string;
  constraints: any;
  context: OrchestrationContext;
  smartWrite: boolean;
  quickGenerate: boolean;
  hasExplicitContent: boolean;
  content: string;
  template?: TemplateType;
  styleReference?: any;
  draftOptions?: { skeletonOnly?: boolean };
  applyPolicy: { required: boolean; tokenTtlMs?: number };
  artifactManager?: FlowArtifactManager;
  resolvedSessionId?: string;
  draftId?: string;
  reviewOptions?: any;
  workflowMeta: WorkflowMeta;
  sessionStylePack?: StylePack;
  fileVersionManager?: FileVersionManager;
  pathNormalizer?: PathNormalizer;
  dependencyGraph?: DependencyGraph;
  indexStateManager?: IndexStateManager;
  traceBuilder?: TraceBuilder;
  runTool: (ctx: OrchestrationContext, tool: string, toolArgs: any) => Promise<any>;
  attachResponse: <T extends Record<string, any>>(payload: T) => any;
}): Promise<any | null> => {
  if (!args.dryRun) return null;

  const refinedIntent = args.refinement
    ? `${args.originalIntent}\nRefinement: ${args.refinement}`
    : args.originalIntent;
  let content = args.content;

  if (args.smartWrite && !args.hasExplicitContent) {
    try {
      const generated = await smartWriteCode(
        args.resolvedPath,
        refinedIntent,
        args.constraints,
        args.context,
        args.runTool,
        (intent, payload) => parseGenerationIntent(intent, payload),
        args.styleReference
      );
      if (generated) {
        content = generated.code;
      }
    } catch (error: any) {
      console.warn(`Smart write (dry-run) failed: ${error.message}`);
    }
  }

  if ((args.quickGenerate || args.smartWrite) && !args.hasExplicitContent && content === '') {
    try {
      const generated = await quickGenerateCode(
        args.resolvedPath,
        refinedIntent,
        (intent, payload) => parseGenerationIntent(intent, payload)
      );
      if (generated) {
        content = generated.code;
      }
    } catch (error: any) {
      console.warn(`Quick generate (dry-run) failed: ${error.message}`);
    }
  }

  if (content === '' && args.template) {
    const templated = await resolveTemplateContent(
      args.template,
      args.resolvedPath,
      refinedIntent,
      args.context,
      args.runTool,
      (value) => toPascalCase(value),
      (value) => looksLikePath(value)
    );
    if (typeof templated === 'string') {
      content = templated;
    }
  }

  let existingContent: string | null = null;
  try {
    existingContent = await args.runTool(args.context, 'code_read', { filePath: args.resolvedPath, view: 'full' });
  } catch {
    existingContent = null;
  }

  const fileVersionsSnapshot = (args.fileVersionManager && args.pathNormalizer)
    ? await buildFileVersionsSnapshot([args.resolvedPath], args.fileVersionManager, args.pathNormalizer)
    : undefined;

  const builder = new DraftPackBuilder({
    skeletonOnly: args.draftOptions?.skeletonOnly !== false,
    includePhantomDiff: true
  });
  const draftPack: DraftPack = await builder.buildForWrite({
    intent: refinedIntent,
    targetPath: args.resolvedPath,
    content,
    existingContent
  });
  if (fileVersionsSnapshot) {
    draftPack.fileVersions = fileVersionsSnapshot;
  }
  draftPack.workflowMeta = args.workflowMeta;
  const applyTokenRecord = (args.applyPolicy.required && args.artifactManager && args.resolvedSessionId)
    ? args.artifactManager.issueApplyToken({
        sessionId: args.resolvedSessionId,
        draftId: draftPack.id,
        ttlMs: args.applyPolicy.tokenTtlMs
      })
    : undefined;

  const preApplyReview = (args.reviewOptions?.preApply ?? true)
    ? await new ReviewReportBuilder(
        {
          dependencyGraph: args.dependencyGraph,
          indexStateManager: args.indexStateManager
        },
        { strictness: args.reviewOptions?.strictness }
      ).review({
        filePath: args.resolvedPath,
        content,
        oldContent: existingContent ?? "",
        constraints: args.constraints,
        stylePack: args.sessionStylePack
      })
    : undefined;
  if (args.traceBuilder && preApplyReview?.semantic) {
    args.traceBuilder.recordEvent({
      area: "other",
      code: "semantic_validation",
      data: {
        verdict: preApplyReview.semantic.verdict,
        diagnostics: Array.isArray(preApplyReview.semantic.diagnostics) ? preApplyReview.semantic.diagnostics.length : 0,
        durationMs: preApplyReview.semantic.stats?.durationMs,
        degraded: Array.isArray(preApplyReview.semantic.degradedReasons) && preApplyReview.semantic.degradedReasons.length > 0,
        phase: "draft_pre_apply"
      }
    });
  }
  if (args.artifactManager) {
    args.artifactManager.store({
      id: draftPack.id,
      type: "draft",
      createdAt: draftPack.createdAt,
      pack: draftPack,
      sessionId: args.resolvedSessionId,
      parentId: args.draftId,
      metadata: { intent: args.originalIntent }
    });
    if (preApplyReview) {
      args.artifactManager.store({
        id: preApplyReview.id,
        type: "review",
        createdAt: preApplyReview.reviewedAt,
        report: preApplyReview,
        sessionId: args.resolvedSessionId,
        parentId: draftPack.id,
        metadata: { intent: args.originalIntent }
      });
    }
  }

  return args.attachResponse({
    success: true,
    status: 'draft',
    draftPack,
    review: preApplyReview,
    ...(applyTokenRecord
      ? { applyToken: applyTokenRecord.token, applyTokenExpiresAt: applyTokenRecord.expiresAt }
      : {}),
    guidance: {
      message: 'DraftPack generated. Review skeleton and phantom diff before applying.',
      suggestedActions: [
        {
          id: "write.apply",
          priority: 1,
          description: "Apply this draft write.",
          rationale: "Uses the draft snapshot (including fileVersions) to block stale applies.",
          toolCall: {
            tool: "write",
            args: {
              intent: refinedIntent,
              targetPath: args.resolvedPath,
              dryRun: false,
              draftId: draftPack.id,
              ...(draftPack.fileVersions ? { fileVersions: draftPack.fileVersions } : {}),
              ...(applyTokenRecord?.token ? { applyToken: applyTokenRecord.token } : {})
            }
          }
        }
      ]
    }
  });
};
