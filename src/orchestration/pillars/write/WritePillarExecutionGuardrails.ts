import type { ConfigurationManager } from '../../../config/ConfigurationManager.js';
import type { ContentSource } from '../../../types/content-source.js';
import type { IndexStateManager } from '../../../indexing/IndexStateManager.js';
import { buildDegradedReasons } from '../../DegradedReasonMapper.js';
import { AuditLog } from '../../../utils/AuditLog.js';
import { evaluateLanguageParityGate, formatParityBlockMessage } from '../../../config/LanguageParityGate.js';
import { evaluateOverrideDecision } from '../shared/OverrideDecision.js';
import { evaluateRepoEditPolicy } from '../shared/RepoGuard.js';
import { checkStaleGuard } from './WritePillarGuardrailFlow.js';
import { createIgnoreMatcher, resolveContentSource } from '../../../utils/ContentSourceResolver.js';
import { resolveTargetPath } from './WritePillarPathUtils.js';
import { createApplyTokenState } from './WritePillarApplyTokenUtils.js';

export async function applyWriteGuardrails(state: Record<string, any>): Promise<{ blockedResponse?: any }> {
  const {
    deps,
    constraints,
    originalIntent,
    contentSource,
    hasExplicitContent,
    initialContent,
    draftId,
    draftContent,
    draftPack,
    draftPhantomFiles,
    draftTargetPath,
    resolvedSessionId,
    applyPolicy,
    applyToken,
    refinement,
    dryRun,
    attachSession
  } = state;

  if (!dryRun && draftId && draftContent && hasExplicitContent) {
    const reasonCode = "draft_content_override_blocked";
    const message = "Draft apply does not allow overriding content. Re-run plan to regenerate the draft content.";
    const nextArgs: Record<string, unknown> = {
      intent: originalIntent,
      targetPath: state.targetPath,
      safety: "plan"
    };
    if (contentSource) {
      nextArgs.contentSource = contentSource;
    } else if (hasExplicitContent) {
      nextArgs.content = initialContent;
    }
    if (refinement) nextArgs.refinement = refinement;
    if (resolvedSessionId) nextArgs.sessionId = resolvedSessionId;
    return {
      blockedResponse: attachSession({
        success: false,
        status: "blocked",
        message,
        errorCode: "DRAFT_CONTENT_OVERRIDE_BLOCKED",
        blockedReason: reasonCode,
        degradedReasons: buildDegradedReasons([reasonCode]),
        createdFiles: [],
        transactionId: null,
        rollbackAvailable: false,
        guidance: {
          message,
          suggestedActions: [
            {
              id: "write.plan",
              priority: 1,
              description: "Re-plan the write to regenerate a draft with the intended content.",
              rationale: "Apply must use the draft snapshot (no re-reading sources) for safety and repeatability.",
              toolCall: { tool: "write", args: nextArgs }
            }
          ]
        }
      })
    };
  }

  if (contentSource) {
    const configurationManager = deps.registry.getMetadata("configurationManager") as ConfigurationManager | undefined;
    const ignoreGlobs = configurationManager?.getIgnoreGlobs?.() ?? [];
    const resolution = await resolveContentSource(contentSource as ContentSource, {
      rootPath: deps.resolveRootPath(),
      fileSystem: deps.resolveFileSystem(),
      repoRegistry: state.repoRegistry,
      repoScope: state.repoScope,
      pathNormalizer: state.pathNormalizer,
      artifactManager: state.artifactManager,
      ignoreMatcher: createIgnoreMatcher(ignoreGlobs)
    });
    if (!resolution.ok) {
      return {
        blockedResponse: attachSession({
          success: false,
          status: resolution.error.status,
          message: resolution.error.message,
          errorCode: resolution.error.errorCode,
          blockedReason: resolution.error.blockedReason,
          createdFiles: [],
          transactionId: null,
          rollbackAvailable: false,
          contentSourceError: resolution.error,
          guidance: {
            message: resolution.error.message,
            suggestedActions: []
          }
        })
      };
    }
    if (state.traceBuilder) {
      state.traceBuilder.recordEvent({
        area: "io",
        code: "content_source_used",
        data: {
          field: "contentSource",
          kind: resolution.meta.kind,
          bytes: typeof resolution.meta.bytes === "number"
            ? resolution.meta.bytes
            : Buffer.byteLength(resolution.content, "utf8"),
          ...(resolution.meta.resolvedPath ? { path: resolution.meta.resolvedPath } : {})
        }
      });
    }
    state.content = resolution.content;
  }

  const requireApplyToken = applyPolicy.required && !dryRun;
  const invalidateApplyTokenOnDrift = () => {
    if (!applyPolicy.invalidateOnDrift || dryRun || !resolvedSessionId || !draftId) return;
    state.artifactManager?.invalidateApplyToken(resolvedSessionId, draftId);
  };
  const applyTokenState = createApplyTokenState({
    applyPolicy,
    requireApplyToken,
    artifactManager: state.artifactManager,
    draftId,
    applyToken,
    originalIntent,
    refinement,
    getResolvedSessionId: () => resolvedSessionId,
    targetPath: state.targetPath,
    contentSource,
    hasExplicitContent,
    initialContent
  });
  const consumeApplyTokenOnce = () => applyTokenState.consumeApplyTokenOnce();
  const validateApplyToken = applyTokenState.validateApplyToken;
  const buildApplyTokenBlockedResponse = applyTokenState.buildApplyTokenBlockedResponse;

  state.requireApplyToken = requireApplyToken;
  state.invalidateApplyTokenOnDrift = invalidateApplyTokenOnDrift;
  state.applyTokenState = applyTokenState;
  state.consumeApplyTokenOnce = consumeApplyTokenOnce;
  state.validateApplyToken = validateApplyToken;
  state.buildApplyTokenBlockedResponse = buildApplyTokenBlockedResponse;

  if (!dryRun && draftId && draftPack && draftPhantomFiles && draftPhantomFiles.length !== 1) {
    const reasonCode = "draft_target_ambiguous";
    const message = "Draft pack contains multiple targets; re-run plan or specify the intended target path.";
    const nextArgs: Record<string, unknown> = {
      intent: originalIntent,
      safety: "plan",
      ...(resolvedSessionId ? { sessionId: resolvedSessionId } : {})
    };
    return {
      blockedResponse: attachSession({
        success: false,
        status: "blocked",
        message,
        errorCode: "DRAFT_TARGET_AMBIGUOUS",
        blockedReason: reasonCode,
        degradedReasons: buildDegradedReasons([reasonCode]),
        guidance: {
          message,
          suggestedActions: [
            {
              id: "write.plan",
              priority: 1,
              description: "Re-plan the write to generate a single-target draft.",
              rationale: "Apply requires an unambiguous draft target.",
              toolCall: { tool: "write", args: nextArgs }
            }
          ]
        }
      })
    };
  }

  if (!dryRun && draftId && draftPack && draftTargetPath && state.targetPath && draftTargetPath !== state.targetPath) {
    const reasonCode = "draft_target_mismatch";
    const message = "Draft target path does not match the requested target. Apply using the draft target path.";
    const nextArgs: Record<string, unknown> = {
      intent: originalIntent,
      targetPath: draftTargetPath,
      safety: "apply",
      draftId,
      ...(applyToken ? { applyToken } : {}),
      ...(resolvedSessionId ? { sessionId: resolvedSessionId } : {})
    };
    return {
      blockedResponse: attachSession({
        success: false,
        status: "blocked",
        message,
        errorCode: "DRAFT_TARGET_MISMATCH",
        blockedReason: reasonCode,
        degradedReasons: buildDegradedReasons([reasonCode], { filePath: state.targetPath }),
        guidance: {
          message,
          suggestedActions: [
            {
              id: "write.apply",
              priority: 1,
              description: "Retry apply using the draft target path.",
              rationale: "Draft content must align with the intended target file.",
              toolCall: { tool: "write", args: nextArgs }
            }
          ]
        }
      })
    };
  }

  if (!state.targetPath) {
    return {
      blockedResponse: attachSession({
        success: false,
        status: 'failure',
        createdFiles: [],
        transactionId: null,
        guidance: {
          message: 'Missing targetPath. Provide a file path to create.',
          suggestedActions: []
        }
      })
    };
  }

  if (requireApplyToken) {
    const validation = validateApplyToken(false);
    if (!validation.valid) {
      return { blockedResponse: attachSession(buildApplyTokenBlockedResponse(validation)) };
    }
  }

  if (!dryRun && draftId && !draftPack && !hasExplicitContent) {
    const reasonCode = "draft_missing";
    const message = "Draft pack not found for this write apply. Re-run the write in plan mode.";
    const nextArgs: Record<string, unknown> = {
      intent: originalIntent,
      targetPath: state.targetPath,
      safety: "plan"
    };
    if (refinement) nextArgs.refinement = refinement;
    if (resolvedSessionId) nextArgs.sessionId = resolvedSessionId;
    return {
      blockedResponse: attachSession({
        success: false,
        status: "blocked",
        message,
        errorCode: "DRAFT_MISSING",
        blockedReason: reasonCode,
        degradedReasons: buildDegradedReasons([reasonCode]),
        guidance: {
          message,
          suggestedActions: [
            {
              id: "write.plan",
              priority: 1,
              description: "Re-plan the write to regenerate a draft pack.",
              rationale: "Apply requires a draft snapshot to be present.",
              toolCall: { tool: "write", args: nextArgs }
            }
          ]
        }
      })
    };
  }

  const resolvedPath = await resolveTargetPath(deps.registry, state.targetPath);
  state.resolvedPath = resolvedPath;

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
  state.overrideDecision = overrideDecision;
  state.bypassIntegrityGuardrails = bypassIntegrityGuardrails;
  state.bypassReviewBlock = bypassReviewBlock;
  state.bypassStaleGuard = bypassStaleGuard;
  state.overrideTrace = overrideEvaluation.trace;
  if (state.traceBuilder) {
    state.traceBuilder.recordEvent({
      area: "guardrails",
      code: "override_evaluated",
      data: {
        decision: overrideDecision?.decision ?? "none",
        bypassIntegrityGuardrails,
        bypassReviewBlock,
        bypassStaleGuard
      }
    });
  }
  if (overrideEvaluation.blockedResponse) {
    if (state.traceBuilder) {
      state.traceBuilder.recordSkip("override", "guardrail_blocked", "override not permitted");
    }
    return { blockedResponse: attachSession(overrideEvaluation.blockedResponse) };
  }
  if (state.repoRegistry && state.pathNormalizer && state.repoScope) {
    const guard = evaluateRepoEditPolicy({
      filePaths: [resolvedPath],
      repoScope: state.repoScope,
      repoRegistry: state.repoRegistry,
      pathNormalizer: state.pathNormalizer,
      allowCrossRepoEdits: state.allowCrossRepoEdits
    });
    if (guard.blocked) {
      const reason = guard.blockedReason ?? "cross_repo_edit_blocked";
      const degradedReasons = buildDegradedReasons([reason]);
      const guidanceMessage = reason === "cross_repo_edit_blocked"
        ? "Set allowCrossRepoEdits=true in <KAIRO_DIR>/config/.mcp-config.json for involved repos, then rerun with allowCrossRepoEdits:true."
        : "Adjust repoScope to include the target repository or use the default repo.";
      if (state.traceBuilder) {
        state.traceBuilder.recordSkip("repo_scope", "policy_disabled", reason);
      }
      return {
        blockedResponse: attachSession({
          success: false,
          status: "blocked",
          message: guard.message ?? "Blocked by repo scope policy.",
          errorCode: guard.errorCode ?? "CROSS_REPO_EDIT_BLOCKED",
          blockedReason: reason,
          degradedReasons,
          guidance: { message: guidanceMessage }
        })
      };
    }
  }

  const staleGuard = await checkStaleGuard({
    indexStateManager: deps.registry.getMetadata("indexStateManager") as IndexStateManager | undefined,
    dryRun,
    bypass: bypassStaleGuard,
    workflowWarnings: state.workflowWarnings
  });
  if (state.traceBuilder) {
    state.traceBuilder.recordEvent({
      area: "guardrails",
      code: "stale_guard",
      data: { blocked: staleGuard.blocked, bypassed: bypassStaleGuard }
    });
  }
  if (staleGuard.blocked) {
    if (state.traceBuilder) {
      state.traceBuilder.recordSkip("stale_guard", "guardrail_blocked", "index stale risk high");
    }
    return {
      blockedResponse: attachSession({
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
              priority: 1,
              description: "Rebuild index before apply.",
              rationale: "High stale risk reduces apply safety.",
              tags: ["repair_ladder", "attempt_2"],
              toolCall: { tool: "manage", args: { command: "reindex" } }
            }
          ]
        },
        indexSnapshot: staleGuard.snapshot
      })
    };
  }

  const parityGate = await evaluateLanguageParityGate({
    filePath: resolvedPath,
    operation: dryRun ? "write_plan" : "write_apply"
  });
  if (state.traceBuilder) {
    state.traceBuilder.recordEvent({
      area: "capabilities",
      code: "parity_gate",
      data: {
        blocked: parityGate.outcome === "block",
        languageId: parityGate.languageId ?? null,
        reasons: Array.isArray(parityGate.reasons) ? parityGate.reasons.slice(0, 3) : []
      }
    });
  }
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

  state.attachResponse = attachResponse;
  state.parityDegradedReasons = parityDegradedReasons;

  if (!dryRun && parityGate.outcome === "block") {
    const message = formatParityBlockMessage({ filePath: resolvedPath, result: parityGate });
    if (state.traceBuilder) {
      state.traceBuilder.recordSkip("parity_gate", "guardrail_blocked", "language parity gate blocked");
    }
    return {
      blockedResponse: attachResponse({
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
      })
    };
  }

  return {};
}
