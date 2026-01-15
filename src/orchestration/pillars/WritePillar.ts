import crypto from 'crypto';
import path from 'path';
import { InternalToolRegistry } from '../InternalToolRegistry.js';
import { OrchestrationContext } from '../OrchestrationContext.js';
import { ParsedIntent } from '../IntentRouter.js';
import { metrics } from '../../utils/MetricsCollector.js';
import { type TemplateType, type TemplateContext } from '../../generation/SimpleTemplateGenerator.js';
import { FeatureFlags } from '../../config/FeatureFlags.js';

import {
    smartWriteCode,
    quickGenerateCode,
    resolveTemplateContent
} from "./write/CodeGeneration.js";
import {
    evaluateIntegrityGuardrails,
    normalizeGuardrailContent,
    resolveGuardrailTargetPath
} from "../guardrails/IntegrityGuardrails.js";
import type { DependencyGraph } from "../../ast/DependencyGraph.js";
import type { IndexStateManager } from "../../indexing/IndexStateManager.js";
import type { DraftPack, StylePack, WorkflowMeta } from "../../types/flow-artifacts.js";
import { DraftPackBuilder } from "../../generation/draft-pack-builder.js";
import { ReviewReportBuilder } from "../../generation/review-report-builder.js";
import type { FlowArtifactManager } from "../flow-artifact-manager.js";
import { buildDegradedReasons } from "../DegradedReasonMapper.js";
import type { FileVersionManager } from "../../engine/FileVersionManager.js";
import {
  evaluateLanguageParityGate,
  formatParityBlockMessage
} from "../../config/LanguageParityGate.js";
import type { RepoRegistry } from "../../config/RepoRegistry.js";
import type { PathNormalizer } from "../../utils/PathNormalizer.js";
import { normalizeRepoScope } from "../../utils/RepoScope.js";
import { evaluateRepoEditPolicy } from "./shared/RepoGuard.js";
import { AuditLog } from "../../utils/AuditLog.js";
import type { OverrideTrace } from "../../utils/GuardrailsOverride.js";
import { normalizeWriteInput } from "./write/WriteInputNormalizer.js";
import { buildWorkflowMeta, buildWorkflowWarnings } from "./shared/WorkflowMeta.js";
import { evaluateOverrideDecision } from "./shared/OverrideDecision.js";
import { evaluateIntegrityGuardrailBlock } from "./shared/IntegrityGuardrailDecision.js";

export class WritePillar {
  constructor(private readonly registry: InternalToolRegistry) {}

  private computeHash(content: string): { algorithm: 'xxhash' | 'sha256'; value: string } {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return { algorithm: 'sha256', value: hash };
  }


  public async execute(intent: ParsedIntent, context: OrchestrationContext): Promise<any> {
    const stopTotal = metrics.startTimer("write.total_ms");
    try {
      const artifactManager = this.registry.getMetadata<FlowArtifactManager>("flowArtifactManager");
      const {
        constraints,
        targets,
        originalIntent,
        targetPath,
        template,
        content: initialContent,
        hasExplicitContent,
        safeWrite,
        quickGenerate,
        smartWrite,
        styleReference,
        resolvedSessionId,
        sessionPolicy,
        resolvedOptions,
        dryRun,
        traceEnabled,
        draftOptions,
        reviewOptions,
        draftId,
        refinement
      } = normalizeWriteInput(intent, {
        resolveSessionId: (rawSessionId, fallback) => artifactManager?.resolveSessionId(rawSessionId, fallback),
        getSessionPolicy: (sessionId) => (sessionId ? artifactManager?.getSession(sessionId)?.policy : undefined)
      });
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
      const stylePackOverride = this.resolveStylePack((constraints as any).stylePack, artifactManager);
      const sessionStylePack = stylePackOverride
        ?? (resolvedSessionId && artifactManager
          ? artifactManager.getLatestStylePack(resolvedSessionId)
          : undefined);
      const draftArtifact = draftId ? artifactManager?.get(draftId) : undefined;
      const draftPack = draftArtifact?.type === "draft" ? (draftArtifact as any).pack : undefined;
      const draftContent = draftPack?.phantomFiles?.[0]?.content as string | undefined;
      const expectedFileVersions = (constraints as any).fileVersions ?? draftPack?.fileVersions;
      const workflowMeta = buildWorkflowMeta({
        sessionId: resolvedSessionId,
        dryRun,
        stylePack: sessionStylePack,
        artifactManager
      });
      const workflowWarnings = buildWorkflowWarnings(workflowMeta, Boolean(resolvedSessionId));
      let overrideTrace: OverrideTrace | undefined;
      const repoRegistry = this.registry.getMetadata<RepoRegistry>("repoRegistry");
      const pathNormalizer = this.registry.getMetadata<PathNormalizer>("pathNormalizer");
      const fileVersionManager = this.registry.getMetadata<FileVersionManager>("fileVersionManager");
      const allowCrossRepoEdits = Boolean((constraints as any).allowCrossRepoEdits);
      const repoScopeParams = {
        repoScope: (constraints as any).repoScope,
        repoId: (constraints as any).repoId,
        repoIds: (constraints as any).repoIds
      };
      const repoScope = repoRegistry && pathNormalizer
        ? normalizeRepoScope(repoScopeParams, repoRegistry, { defaultMode: "default" })
        : undefined;
      const attachSession = <T extends Record<string, any>>(payload: T): T & { sessionId?: string; workflowMeta: WorkflowMeta; workflowWarnings?: string[] } => {
        const next = {
          ...payload,
          workflowMeta,
          ...(traceEnabled
            ? {
                effectiveOptions: {
                  profile: resolvedOptions.effective.profile,
                  safety: resolvedOptions.effective.safety,
                  dryRun,
                  reviewOptions,
                  diffMode: resolvedOptions.effective.diffMode
                },
                decisionTrace: {
                  dryRun: {
                    explicit: typeof constraints.dryRun === "boolean",
                    resolved: dryRun
                  },
                  safety: resolvedOptions.effective.safety ?? null,
                  profile: resolvedOptions.effective.profile ?? null
                }
              }
            : {})
        } as T & { sessionId?: string; workflowMeta: WorkflowMeta; workflowWarnings?: string[] };
        if (workflowWarnings.length > 0) {
          next.workflowWarnings = workflowWarnings;
        }
        if (overrideTrace) {
          (next as any).overrideTrace = overrideTrace;
        }
        return resolvedSessionId ? { ...next, sessionId: resolvedSessionId } : next;
      };

      if (!targetPath) {
        return attachSession({
          success: false,
          status: 'failure',
          createdFiles: [],
          transactionId: null,
          guidance: {
            message: 'Missing targetPath. Provide a file path to create.',
            suggestedActions: []
          }
        });
      }

      const resolvedPath = await this.resolveTargetPath(targetPath);
      const overrideEvaluation = await evaluateOverrideDecision({
        constraints,
        targetFiles: [resolvedPath],
        pillar: "write",
        repoId: typeof (constraints as any).repoId === "string" ? (constraints as any).repoId : undefined,
        auditLogAppend: AuditLog.append
      });
      const overrideDecision = overrideEvaluation.decision ?? undefined;
      const bypassIntegrityGuardrails = overrideEvaluation.bypass.integrityGuardrails;
      const bypassReviewBlock = overrideEvaluation.bypass.reviewPolicy;
      const bypassStaleGuard = overrideEvaluation.bypass.staleGuard;
      overrideTrace = overrideEvaluation.trace;
      if (overrideEvaluation.blockedResponse) {
        return attachSession(overrideEvaluation.blockedResponse);
      }
      if (repoRegistry && pathNormalizer && repoScope) {
        const guard = evaluateRepoEditPolicy({
          filePaths: [resolvedPath],
          repoScope,
          repoRegistry,
          pathNormalizer,
          allowCrossRepoEdits
        });
        if (guard.blocked) {
          const reason = guard.blockedReason ?? "cross_repo_edit_blocked";
          const degradedReasons = buildDegradedReasons([reason]);
          const guidanceMessage = reason === "cross_repo_edit_blocked"
            ? "Set allowCrossRepoEdits=true in .kairo/config/mcp-config.json for involved repos, then rerun with allowCrossRepoEdits:true."
            : "Adjust repoScope to include the target repository or use the default repo.";
          return attachSession({
            success: false,
            status: "blocked",
            message: guard.message ?? "Blocked by repo scope policy.",
            errorCode: guard.errorCode ?? "CROSS_REPO_EDIT_BLOCKED",
            blockedReason: reason,
            degradedReasons,
            guidance: { message: guidanceMessage }
          });
        }
      }

      const staleGuard = await this.checkStaleGuard({
        indexStateManager: this.registry.getMetadata<IndexStateManager>("indexStateManager"),
        dryRun,
        bypass: bypassStaleGuard,
        workflowWarnings
      });
      if (staleGuard.blocked) {
        return attachSession({
          success: false,
          status: "blocked",
          message: staleGuard.message,
          errorCode: "INDEX_STALE_HIGH",
          blockedReason: "index_stale_high",
          guidance: {
            message: staleGuard.message,
            suggestedActions: [
              {
                id: "manage.reindex",
                description: "Rebuild index before apply.",
                toolCall: { tool: "manage", args: { command: "reindex" } }
              }
            ]
          },
          indexSnapshot: staleGuard.snapshot
        });
      }
      const parityGate = await evaluateLanguageParityGate({
        filePath: resolvedPath,
        operation: dryRun ? "write_plan" : "write_apply"
      });
      const parityDegradedReasons = parityGate.reasons.length > 0
        ? buildDegradedReasons(parityGate.reasons, {
          languageId: parityGate.languageId,
          filePath: resolvedPath
        })
        : undefined;
      const applyParitySignals = <T extends Record<string, any>>(payload: T): T => {
        if (!parityDegradedReasons || parityDegradedReasons.length === 0) {
          return payload;
        }
        const mergedReasons = [
          ...(Array.isArray(payload.degradedReasons) ? payload.degradedReasons : []),
          ...parityDegradedReasons
        ];
        return {
          ...payload,
          degraded: Boolean(payload.degraded) || mergedReasons.length > 0,
          degradedReasons: mergedReasons
        };
      };
      const attachResponse = <T extends Record<string, any>>(payload: T) => {
        const response = attachSession(applyParitySignals(payload));
        if (overrideDecision) {
          void AuditLog.append({
            pillar: "write",
            operation: dryRun ? "dry_run" : "apply",
            decision: overrideDecision.decision,
            actor: overrideDecision.approval?.approvedBy,
            reason: overrideDecision.approval?.reason,
            ticket: overrideDecision.approval?.ticket,
            scope: overrideDecision.scope,
            requested: overrideDecision.requestedAllow,
            effective: overrideDecision.effectiveAllow,
            targetFiles: [resolvedPath],
            result: {
              success: Boolean((payload as any).success),
              status: (payload as any).status,
              errorCode: (payload as any).errorCode
            }
          });
        }
        return response;
      };

      if (!dryRun && parityGate.outcome === "block") {
        const message = formatParityBlockMessage({ filePath: resolvedPath, result: parityGate });
        return attachResponse({
          success: false,
          status: "blocked",
          message,
          createdFiles: [],
          transactionId: '',
          rollbackAvailable: false,
          blockedReason: parityGate.reasons[0] ?? "language_parity_missing",
          blockingErrors: ["LANGUAGE_PARITY_MISSING"],
          errorCode: "LANGUAGE_PARITY_MISSING",
          guidance: { message }
        });
      }

      const fileVersionsSnapshot = dryRun
        ? await this.buildFileVersionsSnapshot([resolvedPath], fileVersionManager, pathNormalizer)
        : undefined;

      if (dryRun) {
        const refinedIntent = refinement ? `${originalIntent}\nRefinement: ${refinement}` : originalIntent;
        if (!hasExplicitContent && draftContent) {
          content = draftContent;
        }
        if (smartWrite && !hasExplicitContent) {
          try {
            const generated = await smartWriteCode(
              resolvedPath,
              refinedIntent,
              constraints,
              context,
              (ctx, tool, args) => this.runTool(ctx, tool, args),
              (i, p) => this.parseGenerationIntent(i, p),
              styleReference
            );
            if (generated) {
              content = generated.code;
            }
          } catch (error: any) {
            console.warn(`Smart write (dry-run) failed: ${error.message}`);
          }
        }

        if ((quickGenerate || smartWrite) && !hasExplicitContent && content === '') {
          try {
            const generated = await quickGenerateCode(resolvedPath, refinedIntent, (i, p) => this.parseGenerationIntent(i, p));
            if (generated) {
              content = generated.code;
            }
          } catch (error: any) {
            console.warn(`Quick generate (dry-run) failed: ${error.message}`);
          }
        }

        if (content === '' && template) {
          const templated = await resolveTemplateContent(
            template,
            resolvedPath,
            refinedIntent,
            context,
            (ctx, tool, args) => this.runTool(ctx, tool, args),
            (v) => this.toPascalCase(v),
            (v) => this.looksLikePath(v)
          );
          if (typeof templated === 'string') {
            content = templated;
          }
        }

        let existingContent: string | null = null;
        try {
          existingContent = await this.runTool(context, 'code_read', { filePath: resolvedPath, view: 'full' });
        } catch {
          existingContent = null;
        }

        const builder = new DraftPackBuilder({
          skeletonOnly: draftOptions?.skeletonOnly !== false,
          includePhantomDiff: true
        });
        const draftPack: DraftPack = await builder.buildForWrite({
          intent: refinedIntent,
          targetPath: resolvedPath,
          content,
          existingContent
        });
        if (fileVersionsSnapshot) {
          draftPack.fileVersions = fileVersionsSnapshot;
        }
        draftPack.workflowMeta = workflowMeta;

        const preApplyReview = (reviewOptions?.preApply ?? true)
          ? await new ReviewReportBuilder(
              {
                dependencyGraph: this.registry.getMetadata<DependencyGraph>("dependencyGraph"),
                indexStateManager: this.registry.getMetadata<IndexStateManager>("indexStateManager")
              },
              { strictness: reviewOptions?.strictness }
            ).review({
              filePath: resolvedPath,
              content,
              oldContent: existingContent ?? "",
              constraints,
              stylePack: sessionStylePack
            })
          : undefined;
        if (artifactManager) {
          artifactManager.store({
            id: draftPack.id,
            type: "draft",
            createdAt: draftPack.createdAt,
            pack: draftPack,
            sessionId: resolvedSessionId,
            parentId: draftId,
            metadata: { intent: originalIntent }
          });
          if (preApplyReview) {
            artifactManager.store({
              id: preApplyReview.id,
              type: "review",
              createdAt: preApplyReview.reviewedAt,
              report: preApplyReview,
              sessionId: resolvedSessionId,
              parentId: draftPack.id,
              metadata: { intent: originalIntent }
            });
          }
        }

        return attachResponse({
          success: true,
          status: 'draft',
          draftPack,
          review: preApplyReview,
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
                    targetPath: resolvedPath,
                    dryRun: false,
                    draftId: draftPack.id,
                    ...(draftPack.fileVersions ? { fileVersions: draftPack.fileVersions } : {})
                  }
                }
              }
            ]
          }
        });
      }

      const fileVersions = expectedFileVersions;

      if (smartWrite && !hasExplicitContent) {
        const stopSmartWrite = metrics.startTimer("write.smart_write_ms");
        try {
          const generated = await smartWriteCode(
            resolvedPath,
            originalIntent,
            constraints,
            context,
            (ctx, tool, args) => this.runTool(ctx, tool, args),
            (i, p) => this.parseGenerationIntent(i, p),
            styleReference
          );
          stopSmartWrite();
          
          if (generated) {
            content = generated.code;
            const result = await this.writeGeneratedCode(
              resolvedPath,
              content,
              originalIntent,
              context,
              generated.templateType,
              generated.imports,
              constraints,
              resolvedSessionId,
              reviewOptions,
              sessionStylePack,
              fileVersions,
              { integrityGuardrails: bypassIntegrityGuardrails, reviewPolicy: bypassReviewBlock }
            );
            return attachResponse(result);
          }
        } catch (error: any) {
          stopSmartWrite();
          console.warn(`Smart write failed: ${error.message}, falling back to quickGenerate`);
        }
      }

      if ((quickGenerate || smartWrite) && !hasExplicitContent) {
        const stopGenerate = metrics.startTimer("write.quick_generate_ms");
        try {
          const generated = await quickGenerateCode(resolvedPath, originalIntent, (i, p) => this.parseGenerationIntent(i, p));
          stopGenerate();
          if (generated) {
            content = generated.code;
            const result = await this.writeGeneratedCode(
              resolvedPath,
              content,
              originalIntent,
              context,
              generated.templateType,
              undefined,
              constraints,
              resolvedSessionId,
              reviewOptions,
              sessionStylePack,
              fileVersions,
              { integrityGuardrails: bypassIntegrityGuardrails, reviewPolicy: bypassReviewBlock }
            );
            return attachResponse(result);
          }
        } catch (error: any) {
          stopGenerate();
          console.warn(`Quick generate failed: ${error.message}`);
        }
      }

      if (hasExplicitContent && safeWrite) {
        const stopSafePatch = metrics.startTimer("write.safe_patch_ms");
        try {
          let existingContent = '';
          try {
            existingContent = await this.runTool(context, 'code_read', { filePath: resolvedPath, view: 'full' });
          } catch {
            try {
              await this.runTool(context, 'file_write', { filePath: resolvedPath, content: '' });
            } catch {
              await this.runTool(context, 'edit_apply', {
                edits: [{ filePath: resolvedPath, operation: 'create', replacementString: '' }],
                dryRun: false,
                createMissingDirectories: true,
                fileVersions
              });
            }
            existingContent = '';
          }

          let guardrailResult = await this.evaluateGuardrails(
            context,
            resolvedPath,
            existingContent,
            content,
            constraints
          );
          const guardrailDecision = evaluateIntegrityGuardrailBlock({
            guardrailResult,
            dryRun: false,
            bypass: bypassIntegrityGuardrails,
            workflowWarnings,
            warningMessage: "Override bypassed integrity guardrails blocking for this apply.",
            downgradeOnBypass: false
          });
          guardrailResult = guardrailDecision.guardrailResult;
          if (guardrailDecision.blocked) {
            stopSafePatch();
            return attachResponse({
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
          const reviewBlock = await this.checkReviewBlock({
            filePath: resolvedPath,
            content,
            oldContent: existingContent,
            guardrailResult,
            constraints,
            reviewOptions,
            stylePack: sessionStylePack,
            overrideBypass: bypassReviewBlock
          });
          if (reviewBlock.blocked) {
            stopSafePatch();
            return attachResponse({
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
            replacementString: content,
            indexRange: { start: 0, end: existingContent.length },
            expectedHash: existingContent ? this.computeHash(existingContent) : undefined
          };

          const result = await this.runTool(context, 'edit_transaction', {
            filePath: resolvedPath,
            edits: [edit],
            dryRun: false,
            fileVersions
          });

          stopSafePatch();

          if (result?.errorCode === "FILE_VERSION_MISMATCH") {
            return attachResponse(this.buildFileVersionMismatchResponse({
              filePath: resolvedPath,
              intent: originalIntent,
              writeMode: "safe",
              sessionId: resolvedSessionId,
              currentFileStates: result.updatedFileStates
            }));
          }

          return attachResponse({
            success: result.success ?? true,
            status: result.success === false ? 'failure' : 'success',
            createdFiles: result.success ? [{ path: resolvedPath, description: `Written (safe mode) from intent: ${originalIntent}` }] : [],
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
                      toolCall: { tool: 'read', args: { action: 'view_full', target: resolvedPath } }
                    }
                  ]
                : []
            }
          });
        } catch (error: any) {
          stopSafePatch();
          return attachResponse({
            success: false,
            status: 'failure',
            createdFiles: [],
            transactionId: '',
            rollbackAvailable: false,
            writeMode: 'safe',
            guidance: { message: `Safe write failed: ${error.message}`, suggestedActions: [] }
          });
        }
      }

      if (hasExplicitContent && !safeWrite) {
        let existingContent = '';
        try {
          existingContent = await this.runTool(context, 'code_read', { filePath: resolvedPath, view: 'full' });
        } catch {
          existingContent = '';
        }
        let guardrailResult = await this.evaluateGuardrails(
          context,
          resolvedPath,
          existingContent,
          content,
          constraints
        );
        const guardrailDecision = evaluateIntegrityGuardrailBlock({
          guardrailResult,
          dryRun: false,
          bypass: bypassIntegrityGuardrails,
          workflowWarnings,
          warningMessage: "Override bypassed integrity guardrails blocking for this apply.",
          downgradeOnBypass: false
        });
        guardrailResult = guardrailDecision.guardrailResult;
        if (guardrailDecision.blocked) {
          return attachResponse({
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
        const reviewBlock = await this.checkReviewBlock({
          filePath: resolvedPath,
          content,
          oldContent: existingContent,
          guardrailResult,
          constraints,
          reviewOptions,
          stylePack: sessionStylePack,
          overrideBypass: bypassReviewBlock
        });
        if (reviewBlock.blocked) {
          return attachResponse({
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
          await this.runTool(context, 'file_write', { filePath: resolvedPath, content });
        } catch {
          const fallback = await this.runTool(context, 'edit_apply', {
            edits: [{ filePath: resolvedPath, operation: 'create', replacementString: content }],
            dryRun: false,
            createMissingDirectories: true,
            fileVersions
          });
          if (fallback?.errorCode === "FILE_VERSION_MISMATCH") {
            return attachResponse(this.buildFileVersionMismatchResponse({
              filePath: resolvedPath,
              intent: originalIntent,
              writeMode: "fast",
              sessionId: resolvedSessionId,
              currentFileStates: fallback.updatedFileStates
            }));
          }
        }

        return attachResponse({
          success: true,
          status: 'success',
          createdFiles: [{ path: resolvedPath, description: `Written from intent: ${originalIntent}` }],
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
                toolCall: { tool: 'read', args: { action: 'view_full', target: resolvedPath } }
              }
            ]
          }
        });
      }

      let existingContent: string | null = null;
      try {
        existingContent = await this.runTool(context, 'code_read', { filePath: resolvedPath, view: 'full' });
      } catch {
        existingContent = null;
      }

      if (existingContent === null) {
        try {
          await this.runTool(context, 'file_write', { filePath: resolvedPath, content: '' });
        } catch {
          const fallback = await this.runTool(context, 'edit_apply', {
            edits: [{ filePath: resolvedPath, operation: 'create', replacementString: '' }],
            dryRun: false,
            createMissingDirectories: true,
            fileVersions
          });
          if (fallback?.errorCode === "FILE_VERSION_MISMATCH") {
            return attachResponse(this.buildFileVersionMismatchResponse({
              filePath: resolvedPath,
              intent: originalIntent,
              writeMode: "safe",
              sessionId: resolvedSessionId,
              currentFileStates: fallback.updatedFileStates
            }));
          }
        }
      }

      if (content === '' && template) {
        const templated = await resolveTemplateContent(template, resolvedPath, originalIntent, context, (ctx, tool, args) => this.runTool(ctx, tool, args), (v) => this.toPascalCase(v), (v) => this.looksLikePath(v));
        if (typeof templated === 'string') {
          content = templated;
        }
      }

      if (content === '' && existingContent === null) {
        return attachResponse({
          success: true,
          status: 'success',
          createdFiles: [{ path: resolvedPath, description: `Created from intent: ${originalIntent}` }],
          transactionId: null,
          guidance: {
            message: 'Empty file created.',
            suggestedActions: [
              {
                id: 'read.view_full',
                priority: 1,
                description: 'Review the updated file content.',
                rationale: 'Verify the write applied as intended.',
                toolCall: { tool: 'read', args: { action: 'view_full', target: resolvedPath } }
              }
            ]
          }
        });
      }

      const edit = existingContent === null
        ? { targetString: '', replacementString: content, insertMode: 'at' as const, insertLineRange: { start: 1 } }
        : { targetString: existingContent, replacementString: content };

      const guardrailResult = await this.evaluateGuardrails(
        context,
        resolvedPath,
        existingContent ?? '',
        content,
        constraints
      );
      if (guardrailResult?.status === 'block') {
        if (bypassIntegrityGuardrails) {
          workflowWarnings.push("Override bypassed integrity guardrails blocking for this apply.");
        } else {
        return attachResponse({
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
      const reviewBlock = await this.checkReviewBlock({
        filePath: resolvedPath,
        content,
        oldContent: existingContent ?? '',
        guardrailResult,
        constraints,
        reviewOptions,
        stylePack: sessionStylePack,
        overrideBypass: bypassReviewBlock
      });
      if (reviewBlock.blocked) {
        return attachResponse({
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

      const editResult = await this.runTool(context, 'edit_transaction', {
        filePath: resolvedPath,
        edits: [edit],
        dryRun: false,
        fileVersions
      });

      if (editResult?.errorCode === "FILE_VERSION_MISMATCH") {
        return attachResponse(this.buildFileVersionMismatchResponse({
          filePath: resolvedPath,
          intent: originalIntent,
          writeMode: "safe",
          sessionId: resolvedSessionId,
          currentFileStates: editResult.updatedFileStates
        }));
      }

      const reasonCodes = Array.isArray(guardrailResult?.blockingErrors)
        ? guardrailResult.blockingErrors
        : undefined;
      const degradedReasons = buildDegradedReasons(reasonCodes, { filePath: resolvedPath });

      return attachResponse({
        success: editResult.success ?? true,
        status: editResult.success === false ? 'failure' : 'success',
        createdFiles: [{ path: resolvedPath, description: `Written from intent: ${originalIntent}` }],
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
                  toolCall: { tool: 'read', args: { action: 'view_full', target: resolvedPath } }
                }
              ]
            : []
        }
      });
    } finally {
      stopTotal();
    }
  }

  private async resolveTargetPath(targetPath: string): Promise<string> {
    if (!this.looksLikePath(targetPath)) return targetPath;
    if (!/[\\/]/.test(targetPath)) {
      const filenameMatch = await this.registry.execute('project_search', { query: targetPath, type: 'filename', maxResults: 1 });
      if (filenameMatch?.results?.length > 0) return filenameMatch.results[0].path;
    }
    return targetPath;
  }

  private async buildFileVersionsSnapshot(
    filePaths: string[],
    fileVersionManager?: FileVersionManager,
    pathNormalizer?: PathNormalizer
  ): Promise<Record<string, { expectedVersion?: number; expectedHash?: string }> | undefined> {
    if (!fileVersionManager || !pathNormalizer) return undefined;
    const snapshot: Record<string, { expectedVersion?: number; expectedHash?: string }> = {};
    const uniquePaths = Array.from(new Set(filePaths.filter(Boolean)));
    for (const filePath of uniquePaths) {
      const relPath = pathNormalizer.normalize(filePath);
      try {
        const absPath = pathNormalizer.toAbsolute(relPath);
        const versionInfo = await fileVersionManager.getVersion(absPath);
        snapshot[relPath] = {
          expectedVersion: versionInfo.version,
          expectedHash: versionInfo.contentHash
        };
      } catch {
        // skip missing files
      }
    }
    return Object.keys(snapshot).length > 0 ? snapshot : undefined;
  }

  private buildFileVersionMismatchResponse(args: {
    filePath: string;
    intent: string;
    writeMode: string;
    sessionId?: string;
    currentFileStates?: Record<string, { newVersion: number; newHash: string }>;
  }) {
    const degradedReasons = buildDegradedReasons(["file_version_mismatch"], { filePath: args.filePath });
    return {
      success: false,
      status: "blocked",
      createdFiles: [],
      transactionId: "",
      rollbackAvailable: false,
      writeMode: args.writeMode,
      errorCode: "FILE_VERSION_MISMATCH",
      blockedReason: "file_version_mismatch",
      degradedReasons,
      currentFileStates: args.currentFileStates,
      guidance: {
        message: "The file changed since it was read. Re-read and retry the write.",
        suggestedActions: [
          {
            id: "read.view_full",
            priority: 1,
            description: "Re-read the latest file content.",
            rationale: "Refresh context before reapplying the write.",
            toolCall: { tool: "read", args: { action: "view_full", target: args.filePath } }
          },
          {
            id: "write.plan",
            priority: 2,
            description: "Re-run the write in dry-run mode.",
            rationale: "Validate the write against the current file state.",
            toolCall: { tool: "write", args: { intent: args.intent, target: args.filePath, options: { dryRun: true } } }
          }
        ]
      },
      sessionId: args.sessionId
    };
  }

  private resolveDryRun(constraints: any, sessionId?: string): boolean {
    const raw = constraints?.dryRun;
    if (typeof raw === "boolean") return raw;
    if (sessionId && FeatureFlags.isEnabled(FeatureFlags.WRITERS_FLOW_DEFAULT_DRYRUN)) {
      return true;
    }
    return false;
  }

  private resolveReviewOptions(raw: any, hasSession: boolean): any {
    const reviewOptions = raw ?? {};
    if (!FeatureFlags.isEnabled(FeatureFlags.WRITERS_FLOW_REVIEW_DEFAULTS)) {
      return reviewOptions;
    }
    const defaults = hasSession
      ? { preApply: true, postApply: false, strictness: "balanced", blockOn: ["syntax", "guardrails", "vibe"] }
      : { preApply: true, postApply: false, strictness: "permissive", blockOn: ["syntax"] };
    const hasBlockOn = Array.isArray(reviewOptions?.blockOn);
    return {
      ...defaults,
      ...reviewOptions,
      blockOn: hasBlockOn ? reviewOptions.blockOn : defaults.blockOn
    };
  }

  private resolveStylePack(input: any, artifactManager?: FlowArtifactManager): StylePack | undefined {
    if (!input) return undefined;
    if (typeof input === "string") {
      const artifact = artifactManager?.get(input);
      if (artifact?.type === "style" && "pack" in artifact) {
        return artifact.pack as StylePack;
      }
      return undefined;
    }
    if (input && typeof input === "object") {
      if ("profile" in input && "createdAt" in input) {
        return input as StylePack;
      }
      if (input?.type === "style" && input?.pack) {
        return input.pack as StylePack;
      }
    }
    return undefined;
  }

  private looksLikePath(value: string): boolean {
    return /[\\/]/.test(value) || /\.[a-z0-9]+$/i.test(value);
  }

  private toPascalCase(value: string): string {
    return value
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }

  private async evaluateGuardrails(
    context: OrchestrationContext,
    targetPath: string,
    oldContent: string,
    newContent: string,
    constraints: any
  ): Promise<any> {
    const dependencyGraph = this.registry.getMetadata<DependencyGraph>("dependencyGraph");
    const indexStateManager = this.registry.getMetadata<IndexStateManager>("indexStateManager");
    const guardrailTargetPath = resolveGuardrailTargetPath(targetPath);
    return evaluateIntegrityGuardrails({
      targetPath: guardrailTargetPath,
      oldContent: normalizeGuardrailContent(oldContent),
      newContent: normalizeGuardrailContent(newContent),
      dependencyGraph,
      indexStateManager,
      constraints,
      runTool: (tool, args) => this.runTool(context, tool, args),
      applyMode: true
    });
  }

  private async checkReviewBlock(params: {
    filePath: string;
    content: string;
    oldContent: string;
    guardrailResult?: any;
    constraints?: any;
    reviewOptions: any;
    stylePack?: any;
    overrideBypass?: boolean;
  }): Promise<{ blocked: boolean; review?: any; message?: string; reasons?: Array<{ kind: string; verdict: string }> }> {
    const blockOn = Array.isArray(params.reviewOptions?.blockOn) ? params.reviewOptions.blockOn : [];
    if (blockOn.length === 0) {
      return { blocked: false };
    }

    const review = await new ReviewReportBuilder(
      {
        dependencyGraph: this.registry.getMetadata<DependencyGraph>("dependencyGraph"),
        indexStateManager: this.registry.getMetadata<IndexStateManager>("indexStateManager")
      },
      { strictness: params.reviewOptions?.strictness }
    ).review({
      filePath: params.filePath,
      content: params.content,
      oldContent: params.oldContent,
      guardrailResult: params.guardrailResult,
      constraints: params.constraints,
      stylePack: params.stylePack
    });

    const reasons = collectBlockReasons(review, blockOn);
    if (reasons.length === 0) {
      return { blocked: false, review, reasons };
    }
    if (params.overrideBypass) {
      return { blocked: false, review, reasons, message: "Review block was bypassed by override." };
    }
    return {
      blocked: true,
      review,
      reasons,
      message: `Review blocked by ${reasons.map((item) => `${item.kind}(${item.verdict})`).join(", ")}.`
    };
  }

  private async checkStaleGuard(args: {
    indexStateManager?: IndexStateManager;
    dryRun: boolean;
    bypass: boolean;
    workflowWarnings: string[];
  }): Promise<{ blocked: boolean; message: string; snapshot?: any }> {
    if (args.dryRun || !args.indexStateManager) {
      return { blocked: false, message: "" };
    }
    const snapshot = await args.indexStateManager.getSnapshot();
    if (snapshot.staleRisk !== "high") {
      return { blocked: false, message: "", snapshot };
    }
    if (args.bypass) {
      args.workflowWarnings.push("Override bypassed stale index guard.");
      return { blocked: false, message: "", snapshot };
    }
    return {
      blocked: true,
      message: "Index staleness is high; reindex before apply.",
      snapshot
    };
  }

  private async runTool(context: OrchestrationContext, tool: string, args: any) {
    const started = Date.now();
    const output = await this.registry.execute(tool, args);
    context.addStep({
      id: `${tool}_${context.getFullHistory().length + 1}`,
      tool,
      args,
      output,
      status: output?.success === false || output?.isError ? 'failure' : 'success',
      duration: Date.now() - started
    });
    return output;
  }

  private parseGenerationIntent(intent: string, targetPath: string): { templateType: TemplateType; context: TemplateContext } | null {
    const lowerIntent = intent.toLowerCase();
    const baseName = path.basename(targetPath, path.extname(targetPath));
    const name = this.extractNameFromIntent(intent, baseName);

    if (lowerIntent.includes('function') || lowerIntent.includes('func')) {
      return {
        templateType: 'function',
        context: {
          name,
          params: this.extractParams(intent),
          returnType: this.extractReturnType(intent),
          export: lowerIntent.includes('export'),
          description: this.extractDescription(intent),
        },
      };
    }

    if (lowerIntent.includes('class')) {
      return {
        templateType: 'class',
        context: {
          name: this.toPascalCase(name),
          export: lowerIntent.includes('export') || !lowerIntent.includes('internal'),
          description: this.extractDescription(intent),
          properties: [],
          methods: [],
        },
      };
    }

    if (lowerIntent.includes('interface') || lowerIntent.includes('type')) {
      return {
        templateType: 'interface',
        context: {
          name: this.toPascalCase(name),
          export: lowerIntent.includes('export') || !lowerIntent.includes('internal'),
          description: this.extractDescription(intent),
          properties: [],
          methods: [],
        },
      };
    }

    return { templateType: 'function', context: { name, export: true, description: intent } };
  }

  private extractNameFromIntent(intent: string, fallback: string): string {
    const patterns = [
      /(?:function|class|interface)\s+([a-zA-Z_][a-zA-Z0-9_]*)/i,
      /(?:named|called)\s+([a-zA-Z_][a-zA-Z0-9_]*)/i,
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:function|class)/i,
    ];
    for (const pattern of patterns) {
      const match = intent.match(pattern);
      if (match && match[1]) return match[1];
    }
    return fallback.replace(/[^a-zA-Z0-9_]/g, '') || 'generated';
  }

  private extractParams(intent: string): string {
    const match = intent.match(/(?:params?|parameters?|args?|arguments?)\s*\(([^)]+)\)/i);
    if (match && match[1]) return match[1].trim();
    const takesMatch = intent.match(/(?:takes?|accepts?)\s+([a-zA-Z0-9_,\s]+)/i);
    if (takesMatch && takesMatch[1]) {
      return takesMatch[1].split(/\s+and\s+|\s*,\s*/).map(p => p.trim()).join(', ');
    }
    return '';
  }

  private extractReturnType(intent: string): string {
    const patterns = [/returns?\s+([a-zA-Z0-9_<>[\]]+)/i, /return\s+type\s*:\s*([a-zA-Z0-9_<>[\]]+)/i];
    for (const pattern of patterns) {
      const match = intent.match(pattern);
      if (match && match[1]) return match[1];
    }
    return 'void';
  }

  private extractDescription(intent: string): string {
    let desc = intent.replace(/^(?:create|generate|make|add|write)\s+/i, '').replace(/^(?:a|an|the)\s+/i, '').trim();
    if (desc.length > 0) desc = desc.charAt(0).toUpperCase() + desc.slice(1);
    return desc || 'Auto-generated code';
  }

  private async writeGeneratedCode(
    filePath: string,
    content: string,
    intent: string,
    context: OrchestrationContext,
    templateType: TemplateType,
    imports?: string[],
    constraints?: any,
    sessionId?: string,
    reviewOptions?: any,
    stylePack?: StylePack,
    fileVersions?: Record<string, { expectedVersion?: number; expectedHash?: string }>,
    overrideBypass?: { integrityGuardrails?: boolean; reviewPolicy?: boolean }
  ): Promise<any> {
    try {
      let finalContent = content;
      if (imports && imports.length > 0) finalContent = imports.join('\n') + '\n\n' + content;
      let existingContent = '';
      try {
        existingContent = await this.runTool(context, 'code_read', { filePath, view: 'full' });
      } catch {
        try {
          await this.runTool(context, 'file_write', { filePath, content: '' });
        } catch {
          await this.runTool(context, 'edit_apply', {
            edits: [{ filePath, operation: 'create', replacementString: '' }],
            dryRun: false,
            createMissingDirectories: true,
            fileVersions
          });
        }
        existingContent = '';
      }
      const guardrailResult = await this.evaluateGuardrails(
        context,
        filePath,
        existingContent,
        finalContent,
        constraints
      );
      if (guardrailResult?.status === 'block') {
        if (overrideBypass?.integrityGuardrails) {
          // Continue despite block.
        } else {
        return {
          success: false,
          status: 'blocked',
          createdFiles: [],
          transactionId: '',
          rollbackAvailable: false,
          writeMode: 'quickGenerate',
          templateType,
          architecturalRisk: guardrailResult.architecturalRisk,
          architecturalWarnings: guardrailResult.architecturalWarnings,
          safetyChecklist: guardrailResult.safetyChecklist,
          blockingErrors: guardrailResult.blockingErrors,
          errorCode: guardrailResult.errorCode ?? 'ARCHITECTURE_BLOCKED',
          blockedReason: guardrailResult.blockedReason ?? 'architectural_violation',
          violations: guardrailResult.violations,
          warnings: guardrailResult.warnings,
          sessionId,
          guidance: {
            message: guardrailResult.violations?.[0]?.message ?? 'Write blocked by integrity guardrails.'
          }
        };
        }
      }
      const reviewBlock = await this.checkReviewBlock({
        filePath,
        content: finalContent,
        oldContent: existingContent,
        guardrailResult,
        constraints,
        reviewOptions: reviewOptions ?? this.resolveReviewOptions(constraints?.reviewOptions, Boolean(sessionId)),
        stylePack: stylePack ?? (sessionId
          ? this.registry.getMetadata<FlowArtifactManager>("flowArtifactManager")?.getLatestStylePack(sessionId)
          : undefined),
        overrideBypass: overrideBypass?.reviewPolicy === true
      });
      if (reviewBlock.blocked) {
        return {
          success: false,
          status: 'blocked',
          createdFiles: [],
          transactionId: '',
          rollbackAvailable: false,
          writeMode: 'quickGenerate',
          templateType,
          blockedReason: 'review_blocked',
          review: reviewBlock.review,
          reviewBlockReasons: reviewBlock.reasons,
          sessionId,
          guidance: {
            message: reviewBlock.message ?? 'Write blocked by review policy.',
            reviewBlockReasons: reviewBlock.reasons
          }
        };
      }
      const edit = { targetString: existingContent, replacementString: finalContent, indexRange: { start: 0, end: existingContent.length }, expectedHash: existingContent ? this.computeHash(existingContent) : undefined };
      const result = await this.runTool(context, 'edit_transaction', { filePath, edits: [edit], dryRun: false, fileVersions });
      if (result?.errorCode === "FILE_VERSION_MISMATCH") {
        return this.buildFileVersionMismatchResponse({
          filePath,
          intent,
          writeMode: "quickGenerate",
          sessionId,
          currentFileStates: result.updatedFileStates
        });
      }
      return {
        success: result.success ?? true,
        status: result.success === false ? 'failure' : 'success',
        createdFiles: result.success ? [{ path: filePath, description: `Generated ${templateType} from intent: ${intent}` }] : [],
        transactionId: result.operation?.id || '',
        rollbackAvailable: true,
        writeMode: 'quickGenerate',
        templateType,
        architecturalRisk: guardrailResult?.architecturalRisk,
        architecturalWarnings: guardrailResult?.architecturalWarnings,
        safetyChecklist: guardrailResult?.safetyChecklist,
        blockingErrors: guardrailResult?.blockingErrors,
        errorCode: guardrailResult?.errorCode,
        blockedReason: guardrailResult?.blockedReason,
        violations: guardrailResult?.violations,
        warnings: guardrailResult?.warnings,
        sessionId,
        guidance: {
          message: result.success ? `Generated ${templateType} with project style. Use 'manage undo' to rollback.` : `Generation failed: ${result.message || 'Unknown error'}`,
          suggestedActions: result.success
            ? [
                {
                  id: 'read.view_full',
                  priority: 1,
                  description: 'Review the updated file content.',
                  rationale: 'Verify the write applied as intended.',
                  toolCall: { tool: 'read', args: { action: 'view_full', target: filePath } }
                }
              ]
            : []
        }
      };
    } catch (error: any) {
      return { success: false, status: 'failure', createdFiles: [], transactionId: '', rollbackAvailable: false, writeMode: 'quickGenerate', sessionId, guidance: { message: `Quick generate failed: ${error.message}`, suggestedActions: [] } };
    }
  }
}

function collectBlockReasons(
  report: {
    syntax?: { verdict?: string };
    semantic?: { verdict?: string };
    guardrails?: { verdict?: string };
    vibeAlignment?: { verdict?: string };
  },
  blockOn: string[]
): Array<{ kind: string; verdict: string }> {
  const reasons: Array<{ kind: string; verdict: string }> = [];
  for (const kind of blockOn) {
    switch (kind) {
      case "syntax": {
        const verdict = report.syntax?.verdict;
        if (verdict && verdict !== "pass") reasons.push({ kind, verdict });
        break;
      }
      case "semantic": {
        const verdict = report.semantic?.verdict;
        if (verdict && verdict !== "pass") reasons.push({ kind, verdict });
        break;
      }
      case "guardrails": {
        const verdict = report.guardrails?.verdict;
        if (verdict && verdict !== "pass") reasons.push({ kind, verdict });
        break;
      }
      case "vibe": {
        const verdict = report.vibeAlignment?.verdict;
        if (verdict && verdict !== "pass") reasons.push({ kind, verdict });
        break;
      }
      default:
        break;
    }
  }
  return reasons;
}
