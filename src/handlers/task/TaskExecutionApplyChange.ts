import { buildDegradedReasons } from "../../orchestration/DegradedReasonMapper.js";
import { buildApplySummary } from "./TaskSummaryUtils.js";
import { buildGuidance, rewriteGuidanceForCompact, mapStatus } from "./TaskGuidanceUtils.js";
import { finalizeTaskResponse } from "./TaskResponseUtils.js";
import { mergeDegradedReasons } from "./TaskDecisionUtils.js";
import { recordTaskMetrics } from "./TaskMetricsUtils.js";
import { attemptAutoRepair } from "./TaskAutoRepairUtils.js";
import { buildVerificationResult } from "./TaskVerificationUtils.js";
import { mergePillarArgs, pickPillarOptions } from "./TaskRoutingUtils.js";
import type { TaskExecutionState } from "./TaskExecutionState.js";

export async function handleApplyChange(state: TaskExecutionState): Promise<any> {
    const applyTargets = state.targetFiles.length > 0
        ? state.targetFiles
        : (state.targetPath ? [state.targetPath] : (state.paths.length > 0 ? state.paths : []));
    const applyLimits = state.responseLimits;
    const changeOptions = pickPillarOptions("change", state.pillarOptions);
    const response = await state.executePillar("change", mergePillarArgs({
        intent: state.request,
        targetFiles: applyTargets.length > 0 ? applyTargets : undefined,
        ...(state.edits.length > 0 ? { edits: state.edits } : {}),
        sessionId: state.sessionId,
        profile: state.profile,
        safety: "apply",
        trace: state.traceEnabled,
        ...(typeof state.args?.refinement === "string" ? { refinement: state.args.refinement } : {}),
        ...(state.draftId ? { draftId: state.draftId } : {}),
        ...(state.applyToken ? { applyToken: state.applyToken } : {}),
        ...(applyLimits ? { limits: applyLimits } : {})
    }, changeOptions, ["intent", "targetFiles", "sessionId", "profile", "safety", "trace", "draftId", "applyToken"]));
    const summary = buildApplySummary({ response, request: state.request });
    let status = mapStatus(response);
    let verification: any | undefined;
    let verificationReasons: string[] = [];
    const autoVerifyTargetPath = (typeof response?.targetFile === "string" ? response.targetFile : undefined)
        ?? (typeof response?.targetPath === "string" ? response.targetPath : undefined)
        ?? applyTargets[0];
    const autoVerifyDraftId = state.draftId;
    const canAutoVerify = status === "success"
        && state.budgetPolicy.maxSteps >= 2
        && Boolean(autoVerifyTargetPath)
        && Boolean(autoVerifyDraftId)
        && Boolean(state.context.fileSystem)
        && Boolean(state.context.flowArtifactManager);
    if (canAutoVerify) {
        const result = await buildVerificationResult(state.context, {
            targetPath: autoVerifyTargetPath,
            draftId: autoVerifyDraftId
        });
        verification = result.verification;
        verificationReasons = result.reasons;
        summary.bullets.push(
            `Auto-verify: exists=${verification.exists ? "yes" : "no"}, draftMatch=${verification.contentMatch === true ? "yes" : (verification.contentMatch === false ? "no" : "unknown")}.`
        );
        if (verificationReasons.length > 0 && status === "success") {
            const isBlocked = verificationReasons.includes("file_missing") || verificationReasons.includes("draft_missing");
            status = isBlocked ? "blocked" : "partial_success";
        }
    }
    const enhancedNextCalls: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> = Array.isArray(state.nextCalls)
        ? [...state.nextCalls]
        : [];
    if (status !== "success") {
        enhancedNextCalls.unshift({
            tool: "task",
            args: {
                request: state.request,
                mode: "plan_change",
                budget: state.budget,
                sessionId: response?.sessionId ?? state.sessionId,
                ...(applyTargets.length > 0 ? { targetFiles: applyTargets } : {}),
                ...(state.edits.length > 0 ? { edits: state.edits } : {}),
                ...(state.outputPayload ? { output: state.outputPayload } : {}),
                ...(state.traceEnabled ? { trace: true } : {})
            },
            reason: "Re-plan to refresh tokens/file versions, then re-apply."
        });
    }
    const verifyDegradedReasons = verificationReasons.length > 0
        ? buildDegradedReasons(verificationReasons, { filePath: verification?.relPath ?? verification?.targetPath })
        : undefined;
    const degradedReasons = mergeDegradedReasons(response?.degradedReasons, verifyDegradedReasons);
    const guidance = rewriteGuidanceForCompact({
        guidance: buildGuidance(
            response?.guidance,
            enhancedNextCalls.length > 0 ? enhancedNextCalls : undefined,
            degradedReasons
        ),
        request: state.request,
        budget: state.budget,
        output: state.outputPayload,
        traceEnabled: state.traceEnabled,
        sessionId: state.sessionId,
        surface: state.surface
    });
    const autoRepair = await attemptAutoRepair(state.context, {
        response,
        sessionId: response?.sessionId ?? state.sessionId,
        profile: state.profile,
        maxTokens: state.maxTokens,
        budget: state.budget,
        targetFiles: applyTargets,
        paths: state.paths
    });
    const artifacts: Array<{ id: string; kind: string; detail: "summary" | "full" }> = [];
    if (response?.review?.id) {
        artifacts.push({ id: response.review.id, kind: "review", detail: "summary" });
    }
    if (response?.postReview?.id) {
        artifacts.push({ id: response.postReview.id, kind: "review", detail: "summary" });
    }
    const details = state.outputFormat === "standard" ? { pillar: "change", response } : undefined;
    const degraded = Boolean(response?.degraded) || verificationReasons.length > 0;
    const payload = {
        ok: true,
        sessionId: response?.sessionId ?? state.sessionId,
        status,
        mode: state.routing.mode,
        budget: state.budget,
        surface: state.surface,
        summary,
        ...(details ? { details } : {}),
        ...(state.draftId ? { draftId: state.draftId } : {}),
        ...(artifacts.length > 0 ? { artifacts } : {}),
        ...(verification ? { verification } : {}),
        ...(response?.degraded !== undefined || verificationReasons.length > 0 ? { degraded } : {}),
        ...(degradedReasons ? { degradedReasons } : {}),
        ...(guidance ? { guidance } : {}),
        ...(autoRepair ? { autoRepair } : {}),
        stats: {
            latencyMs: Date.now() - state.startedAt
        }
    };
    recordTaskMetrics({
        mode: state.routing.mode,
        budget: state.budget,
        stepCount: state.stepCount,
        traceBuilder: state.traceBuilder
    });
    return finalizeTaskResponse({
        response: payload,
        traceBuilder: state.traceBuilder,
        budgetPolicy: state.budgetPolicy,
        maxTokens: state.maxTokens,
        maxChars: state.maxChars
    });
}
