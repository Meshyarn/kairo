import { InternalToolRegistry } from '../../InternalToolRegistry.js';
import { OrchestrationContext } from '../../OrchestrationContext.js';
import { ParsedIntent } from '../../IntentRouter.js';
import { ChangeBudgetManager } from '../../ChangeBudgetManager.js';
import { IntegrityEngine } from '../../../integrity/IntegrityEngine.js';
import type { IntegrityReport } from '../../../integrity/IntegrityTypes.js';
import { metrics } from '../../../utils/MetricsCollector.js';
import { ConfigurationManager } from '../../../config/ConfigurationManager.js';
import { EditResolver } from '../../../engine/EditResolver.js';
import { EditCoordinator } from '../../../engine/EditCoordinator.js';
import { EditorEngine } from '../../../engine/Editor.js';
import { HistoryEngine } from '../../../engine/History.js';
import { UnifiedContextGraph } from '../../context/UnifiedContextGraph.js';
import { NodeFileSystem } from '../../../platform/FileSystem.js';
import type { DependencyGraph } from '../../../ast/DependencyGraph.js';
import type { IndexStateManager } from '../../../indexing/IndexStateManager.js';

import { 
    toImpactReport, 
    collectDependentsFromGraph, 
    analyzeSymbolImpact 
} from "./ImpactAnalysis.js";
import { 
    shouldBlockIntegrity, 
    formatIntegrityBlockMessage 
} from "./IntegrityValidation.js";
import { 
    suggestDocUpdates, 
    shouldSuggestDocs 
} from "./DocumentSuggestion.js";
import { 
    normalizeEdits, 
    formatResolveErrors,
    isLikelyFilePath
} from "./EditExecution.js";
import {
    applyEditsToContent,
    evaluateIntegrityGuardrails,
    normalizeGuardrailContent,
    resolveGuardrailTargetPath
} from "../../guardrails/IntegrityGuardrails.js";
import { DraftPackBuilder } from "../../../generation/draft-pack-builder.js";
import { ReviewReportBuilder } from "../../../generation/review-report-builder.js";
import type { FlowArtifactManager } from "../../flow-artifact-manager.js";
import {
    executeBatchChange,
    executeV2BatchChange
} from "./BatchExecution.js";
import { resolveTargetPath } from "./shared/TargetResolver.js";

export class ChangePillar {
  private fileSystem = new NodeFileSystem(process.cwd());
  
  constructor(private readonly registry: InternalToolRegistry) {}

  private getEditCoordinator(): EditCoordinator {
    const rootPath = process.cwd();
    const editorEngine = new EditorEngine(rootPath, this.fileSystem);
    const historyEngine = new HistoryEngine(rootPath, this.fileSystem);
    return new EditCoordinator(editorEngine, historyEngine);
  }

  private getEditResolver(): EditResolver {
    const rootPath = process.cwd();
    const editorEngine = new EditorEngine(rootPath, this.fileSystem);
    return new EditResolver(this.fileSystem, editorEngine);
  }

  public async execute(intent: ParsedIntent, context: OrchestrationContext): Promise<any> {
    const stopTotal = metrics.startTimer("change.total_ms");
    try {
      const { targets, constraints, originalIntent } = intent;
      const { dryRun = true, includeImpact = false, includeSymbolImpact = false } = constraints;
      const integrityOptions = IntegrityEngine.resolveOptions(constraints.integrity, "change");
      const ucg = context.getState<UnifiedContextGraph>('ucg');
      const reviewOptions = constraints.reviewOptions ?? {};
      const rawSessionId = typeof constraints.sessionId === "string" ? constraints.sessionId : undefined;
      const artifactManager = this.registry.getMetadata<FlowArtifactManager>("flowArtifactManager");
      const resolvedSessionId = artifactManager?.resolveSessionId(rawSessionId, originalIntent);
      const sessionStylePack = resolvedSessionId && artifactManager
        ? artifactManager.getLatestStylePack(resolvedSessionId)
        : undefined;

      const rawEdits = Array.isArray(constraints.edits) ? constraints.edits : [];
      const targetFiles = this.resolveTargetFiles(constraints, targets);
      const editPaths = this.collectEditPaths(rawEdits);
      const shouldBatch = this.shouldUseBatch(constraints, targetFiles, editPaths);
    
      const v2Enabled = ConfigurationManager.getEditorV2Enabled();
      const v2Mode = ConfigurationManager.getEditorV2Mode();
      const useV2 = v2Enabled && v2Mode !== 'off';
    
      if (useV2 && shouldBatch) {
        return executeV2BatchChange(
          { intent, context, rawEdits, targetFiles, dryRun, v2Mode },
          () => this.getEditResolver(),
          () => this.getEditCoordinator()
        );
      }

      if (shouldBatch) {
        const dependencyGraph = this.registry.getMetadata<DependencyGraph>("dependencyGraph");
        const indexStateManager = this.registry.getMetadata<IndexStateManager>("indexStateManager");
        return executeBatchChange(
          { intent, context, rawEdits, targetFiles, dryRun, includeImpact, dependencyGraph, indexStateManager, constraints },
          (ctx, tool, args) => this.runTool(ctx, tool, args),
          (e) => this.extractEditFilePath(e),
          (args) => this.buildFailureGuidance(args)
        );
      }

      let targetPath: string | undefined = constraints.targetPath || targets[0] || this.extractTargetFromEdits(rawEdits);

      let candidates: Array<{ path: string; score?: number; reason: string }> = [];
      if (!targetPath) {
        const resolved = await resolveTargetPath(originalIntent, context, (ctx, tool, args) => this.runTool(ctx, tool, args));
        targetPath = resolved.targetPath;
        candidates = resolved.candidates;
      }

      if (!targetPath) {
        return {
          success: false,
          message: 'Could not identify the target to modify.',
          candidates,
          guidance: {
            message: 'Provide a target file path or select a file via navigate/search.',
            suggestedActions: [
              { pillar: 'navigate', action: 'find', target: originalIntent },
              { pillar: 'change', action: 'retry', intent: originalIntent, target: '<filePath>' }
            ]
          }
        };
      }

      const normalization = normalizeEdits(rawEdits, targetPath);
      const edits = normalization.edits;
      if (edits.length === 0) {
        return {
          success: false,
          message: 'No valid edits provided. Ensure targetContent/targetString and replacement/template are set.',
          invalidEdits: normalization.invalidEdits,
          guidance: {
            message: 'Use read to copy exact text or provide a shorter targetString.',
            suggestedActions: [
              { pillar: 'read', action: 'view_fragment', target: targetPath },
              { pillar: 'change', action: 'retry', intent: originalIntent, target: targetPath }
            ]
          }
        };
      }

      const budget = ChangeBudgetManager.create({
        intentText: originalIntent,
        targetSample: edits[0]?.targetString,
        includeImpact,
        dryRun,
        editCount: edits.length,
        batchMode: Boolean(constraints?.batchMode)
      });
      const allowImpactPreview = includeImpact === true;

      let integrityReport: IntegrityReport | undefined;
      if (integrityOptions && integrityOptions.mode !== "off") {
        integrityReport = (await IntegrityEngine.run(
          {
            query: originalIntent,
            targetPaths: targetPath ? [targetPath] : undefined,
            scope: integrityOptions.scope ?? "auto",
            sources: integrityOptions.sources ?? [],
            limits: integrityOptions.limits ?? {},
            mode: integrityOptions.mode ?? "preflight"
          },
          (tool, args) => this.runTool(context, tool, args)
        )).report;

        if (!dryRun && shouldBlockIntegrity(integrityOptions.mode ?? "preflight", integrityOptions.blockPolicy, integrityReport)) {
          const blockedReport: IntegrityReport = {
            ...integrityReport,
            status: "blocked",
            blockedReason: integrityReport.blockedReason ?? "high_severity_conflict"
          };
          const blockedSummary = formatIntegrityBlockMessage(blockedReport.topFindings);
          return {
            success: false,
            status: "blocked",
            message: blockedSummary,
            operation: "apply",
            targetFile: targetPath,
            integrity: blockedReport,
            guidance: {
              message: blockedSummary
            }
          };
        }
      }

      const dependencyGraph = this.registry.getMetadata<DependencyGraph>("dependencyGraph");
      const indexStateManager = this.registry.getMetadata<IndexStateManager>("indexStateManager");
      let guardrailResult: any = undefined;
      let reviewOriginalContent = "";
      let reviewNextContent = "";
      if (targetPath) {
        const guardrailTargetPath = resolveGuardrailTargetPath(targetPath);
        let originalContent = "";
        try {
          originalContent = await this.fileSystem.readFile(guardrailTargetPath);
        } catch {
          originalContent = "";
        }
        let nextContent = originalContent;
        try {
          nextContent = applyEditsToContent(originalContent, edits).newContent;
        } catch {
          nextContent = originalContent;
        }
        reviewOriginalContent = originalContent;
        reviewNextContent = nextContent;
        guardrailResult = await evaluateIntegrityGuardrails({
          targetPath: guardrailTargetPath,
          oldContent: normalizeGuardrailContent(originalContent),
          newContent: normalizeGuardrailContent(nextContent),
          edits,
          dependencyGraph,
          indexStateManager,
          constraints,
          runTool: (tool, args) => this.runTool(context, tool, args),
          applyMode: !dryRun
        });

        if (!dryRun && guardrailResult?.status === "block") {
          return {
            success: false,
            status: "blocked",
            message: guardrailResult.violations?.[0]?.message ?? "Blocked by integrity guardrails.",
            operation: "apply",
            targetFile: targetPath,
            architecturalRisk: guardrailResult.architecturalRisk,
            architecturalWarnings: guardrailResult.architecturalWarnings,
            blockingErrors: guardrailResult.blockingErrors,
            errorCode: guardrailResult.errorCode ?? "ARCHITECTURE_BLOCKED",
            blockedReason: guardrailResult.blockedReason ?? "architectural_violation",
            safetyChecklist: guardrailResult.safetyChecklist,
            violations: guardrailResult.violations,
            warnings: guardrailResult.warnings,
            guidance: {
              message: guardrailResult.violations?.[0]?.message ?? "Resolve guardrail violations before retrying."
            }
          };
        }
      }

      const allowDependencyAnalysis = budget.allowImpact && targetPath && (!dryRun || includeImpact === true);
      const impactPromise = !dryRun && budget.allowImpact
        ? this.runTool(context, 'impact_analyze', { target: targetPath, edits })
        : Promise.resolve(null);
      
      const dependencyPromise = allowDependencyAnalysis
        ? (async () => {
            const deps = await collectDependentsFromGraph(ucg, targetPath);
            if (deps) {
              return deps;
            }
            return this.runTool(context, 'relationship_analyze', { target: targetPath, mode: 'dependencies', direction: 'both' });
          })()
        : Promise.resolve(null);
      const hotSpotPromise = !dryRun && budget.allowImpact
        ? this.runTool(context, 'hotspot_detect', {})
        : Promise.resolve([]);
      
      const symbolImpactPromise = includeSymbolImpact && targetPath
        ? analyzeSymbolImpact(targetPath, edits, constraints, this.fileSystem)
        : Promise.resolve(null);

      const stopEdit = metrics.startTimer("change.edit_coordinator_ms");
      let editResult: any;
      try {
        editResult = await this.runTool(context, 'edit_transaction', {
          filePath: targetPath,
          edits,
          dryRun,
          options: {
            skipImpactPreview: dryRun && !allowImpactPreview
          }
        });
      } finally {
        stopEdit();
      }

      let finalResult = editResult;
      let autoCorrected = false;
      const autoCorrectionAttempts: string[] = [];

      let allowLevenshtein = budget.allowLevenshtein;
      if (allowLevenshtein) {
        const minTargetLength = 24;
        const tooShort = edits.some((edit: any) => (edit?.targetString?.length ?? 0) < minTargetLength);
        if (tooShort) {
          allowLevenshtein = false;
        } else {
          try {
            const stat = await this.runTool(context, 'file_stat', { path: targetPath });
            if (typeof stat?.size === 'number' && stat.size > 262144) {
              allowLevenshtein = false;
            }
          } catch {
            // ignore
          }
        }
      }

      if (!editResult.success && edits.length > 0) {
        const attempts: Array<{ label: string; edits: any[] }> = [];
        if (budget.allowNormalization) {
          attempts.push({ label: 'whitespace', edits: edits.map((edit: any) => ({ ...edit, fuzzyMode: edit.fuzzyMode ?? 'whitespace' })) });
          attempts.push({ label: 'structural', edits: edits.map((edit: any) => ({ ...edit, normalization: edit.normalization ?? 'structural' })) });
        }
        if (allowLevenshtein) {
          const eligible = edits.every((edit: any) => (edit?.targetString?.length ?? 0) <= budget.maxLevenshteinTargetLength);
          if (eligible) {
            attempts.push({ label: 'fuzzy', edits: edits.map((edit: any) => ({ ...edit, fuzzyMode: edit.fuzzyMode ?? 'levenshtein' })) });
          }
        }
        const maxAttempts = Math.max(0, budget.maxMatchAttempts - 1);
        const limitedAttempts = attempts.slice(0, maxAttempts);
        autoCorrectionAttempts.push(...limitedAttempts.map(attempt => attempt.label));
        for (const attempt of limitedAttempts) {
          const stopCorrect = metrics.startTimer("change.edit_coordinator_ms");
          let correctedResult: any;
          try {
            correctedResult = await this.runTool(context, 'edit_transaction', {
              filePath: targetPath,
              edits: attempt.edits,
              dryRun
            });
          } finally {
            stopCorrect();
          }
          if (correctedResult.success) {
            finalResult = correctedResult;
            autoCorrected = true;
            break;
          }
        }
      }

      const impact = dryRun ? (allowImpactPreview ? (finalResult.impactPreview ?? null) : null) : await impactPromise;
      const deps = await dependencyPromise;
      const hotSpots = await hotSpotPromise;
      const symbolImpact = await symbolImpactPromise;
      let impactReport = toImpactReport(impact, deps, targetPath, hotSpots);
      let architecturalRisk: any = guardrailResult?.architecturalRisk;
      const architecturalWarnings: string[] = Array.isArray(guardrailResult?.architecturalWarnings)
        ? guardrailResult.architecturalWarnings
        : [];
      if (impactReport && architecturalRisk?.riskLevel === "high") {
        impactReport = { ...impactReport, breakingChangeRisk: "high" };
      }
      const plan = dryRun
        ? {
            steps: [
              {
                action: 'modify' as const,
                file: targetPath,
                description: originalIntent,
                diff: finalResult.diff
              }
            ]
          }
        : undefined;

      const failureGuidance = !finalResult.success
        ? this.buildFailureGuidance({
            intent: originalIntent,
            targetPath,
            edits,
            dryRun,
            failureMessage: finalResult.message ?? finalResult.details?.message,
            autoCorrectionAttempts
          })
        : undefined;

      const successGuidance: any = {
        message: dryRun ? 'Change plan generated. Review the diff before applying.' : 'Changes successfully applied.',
        suggestedActions: dryRun ?
          [{
            pillar: 'change',
            action: 'apply',
            intent: originalIntent,
            target: targetPath,
            edits,
            options: { dryRun: false }
          }] :
          [{ pillar: 'manage', action: 'test' }]
      };

      const truncatedDiff = (typeof finalResult.diff === 'string' && finalResult.diff.length > budget.maxDiffBytes)
        ? `${finalResult.diff.slice(0, budget.maxDiffBytes)}\n... (diff truncated)`
        : finalResult.diff;

      let draftPack: any = undefined;
      if (dryRun && targetPath) {
        const originalContent = reviewOriginalContent ?? "";
        const nextContent = reviewNextContent ?? originalContent;
        const builder = new DraftPackBuilder({
          skeletonOnly: constraints?.draftOptions?.skeletonOnly !== false,
          includePhantomDiff: true
        });
        draftPack = await builder.buildForChange({
          intent: originalIntent,
          targetPath,
          oldContent: originalContent,
          newContent: nextContent
        });
      }

      const preApplyReview = (reviewOptions?.preApply ?? dryRun) && targetPath
        ? await new ReviewReportBuilder(
            { dependencyGraph, indexStateManager },
          { strictness: reviewOptions?.strictness }
        ).review({
            filePath: targetPath,
            content: reviewNextContent ?? reviewOriginalContent ?? "",
            oldContent: reviewOriginalContent,
            guardrailResult,
            constraints,
            stylePack: sessionStylePack
          })
        : undefined;

      let postReview: any = undefined;
      if (!dryRun && reviewOptions?.postApply && targetPath && finalResult.success) {
        let currentContent = "";
        try {
          currentContent = await this.fileSystem.readFile(targetPath);
        } catch {
          currentContent = reviewNextContent ?? "";
        }
        postReview = await new ReviewReportBuilder(
          { dependencyGraph, indexStateManager },
          { strictness: reviewOptions?.strictness }
        ).review({
          filePath: targetPath,
          content: currentContent,
          oldContent: reviewOriginalContent,
          constraints,
          stylePack: sessionStylePack
        });
      }
      if (artifactManager) {
        if (draftPack) {
          artifactManager.store({
            id: draftPack.id,
            type: "draft",
            createdAt: draftPack.createdAt,
            pack: draftPack,
            sessionId: resolvedSessionId,
            metadata: { intent: originalIntent }
          });
        }
        if (preApplyReview) {
          artifactManager.store({
            id: preApplyReview.id,
            type: "review",
            createdAt: preApplyReview.reviewedAt,
            report: preApplyReview,
            sessionId: resolvedSessionId,
            parentId: draftPack?.id,
            metadata: { intent: originalIntent }
          });
        }
        if (postReview) {
          artifactManager.store({
            id: postReview.id,
            type: "review",
            createdAt: postReview.reviewedAt,
            report: postReview,
            sessionId: resolvedSessionId,
            parentId: draftPack?.id,
            metadata: { intent: originalIntent }
          });
        }
      }

      let relatedDocs: Array<any> | undefined;
      if (!dryRun && finalResult.success && shouldSuggestDocs(constraints)) {
        const packId = constraints?.evidencePack ?? constraints?.evidencePackId ?? constraints?.packId;
        relatedDocs = await suggestDocUpdates(
          context,
          targetPath,
          edits,
          originalIntent,
          (ctx, tool, args) => this.runTool(ctx, tool, args),
          packId ? { packId } : undefined
        );
        if (relatedDocs && successGuidance?.suggestedActions && relatedDocs.length > 0) {
          const top = relatedDocs[0];
          if (top?.filePath) {
            successGuidance.suggestedActions.push({
              pillar: 'document_section',
              action: 'preview',
              target: top.filePath,
              headingPath: top.sectionPath
            });
          }
        }
      }

      return {
        success: finalResult.success,
        message: finalResult.success ? undefined : (finalResult.message ?? finalResult.details?.message),
        operation: dryRun ? 'plan' : 'apply',
        targetFile: targetPath,
        diff: truncatedDiff,
        plan,
        draftPack,
        review: preApplyReview,
        postReview,
        impactReport,
        architecturalRisk,
        architecturalWarnings: architecturalWarnings.length > 0 ? architecturalWarnings : undefined,
        safetyChecklist: guardrailResult?.safetyChecklist,
        blockingErrors: guardrailResult?.blockingErrors,
        errorCode: guardrailResult?.errorCode,
        blockedReason: guardrailResult?.blockedReason,
        violations: guardrailResult?.violations,
        warnings: guardrailResult?.warnings,
        symbolImpact: symbolImpact || undefined,
        suggestedEdits: (symbolImpact as any)?.suggestedEdits,
        editResult: dryRun ? undefined : finalResult,
        transactionId: finalResult.operation?.id ?? '',
        rollbackAvailable: !dryRun && Boolean(finalResult.success),
        autoCorrected,
        autoCorrectionAttempts: autoCorrectionAttempts.length > 0 ? autoCorrectionAttempts : undefined,
        guidance: failureGuidance ?? successGuidance,
        sessionId: resolvedSessionId,
        relatedDocs,
        integrity: integrityReport,
        degraded: !finalResult.success && autoCorrectionAttempts.length === 0,
        budget: {
          ...budget,
          used: {
            attempts: 1 + autoCorrectionAttempts.length
          }
        }
      };
    } finally {
      stopTotal();
    }
  }

  private async runTool(context: OrchestrationContext, tool: string, args: any) {
    const started = Date.now();
    const output = await this.registry.execute(tool, args);
    context.addStep({
      id: `${tool}_${context.getFullHistory().length + 1}`,
      tool,
      args,
      output,
      status: output?.success === false || output?.isError ? "failure" : "success",
      duration: Date.now() - started
    });
    return output;
  }

  private resolveTargetFiles(constraints: any, targets: string[]): string[] {
    const fromConstraints = Array.isArray(constraints?.targetFiles) ? constraints.targetFiles : [];
    return (fromConstraints.length > 0 ? fromConstraints : targets).filter((t: any) => typeof t === 'string');
  }

  private collectEditPaths(edits: any[]): string[] {
    const paths = new Set<string>();
    for (const edit of edits) {
      const p = edit?.filePath ?? edit?.path;
      if (p) paths.add(p);
    }
    return Array.from(paths);
  }

  private shouldUseBatch(constraints: any, targetFiles: string[], editPaths: string[]): boolean {
    return Boolean(constraints?.batchMode) || targetFiles.length > 1 || editPaths.length > 1;
  }

  private extractTargetFromEdits(edits: any[]): string | undefined {
    for (const edit of edits) {
      const p = edit?.filePath ?? edit?.path;
      if (p) return p;
    }
    return undefined;
  }

  private extractEditFilePath(edit: any): string | undefined {
    const candidate = edit?.filePath ?? edit?.path;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
    const targetCandidate = edit?.target;
    if (isLikelyFilePath(targetCandidate)) {
      return targetCandidate.trim();
    }
    return undefined;
  }

  private buildFailureGuidance(args: any) {
    return {
      message: args.failureMessage || 'Change failed.',
      suggestedActions: [
        { pillar: 'read', action: 'view_fragment', target: args.targetPath },
        { pillar: 'change', action: 'retry', intent: args.intent, target: args.targetPath }
      ]
    };
  }
}
