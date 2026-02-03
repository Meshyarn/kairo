import { buildDegradedReasons } from "../../orchestration/DegradedReasonMapper.js";
import { resolveTargetPath } from "./TaskRoutingUtils.js";
import { buildVerifySummary } from "./TaskSummaryUtils.js";
import { buildGuidance, rewriteGuidanceForCompact } from "./TaskGuidanceUtils.js";
import { finalizeTaskResponse } from "./TaskResponseUtils.js";
import { recordTaskMetrics } from "./TaskMetricsUtils.js";
import { buildVerificationResult } from "./TaskVerificationUtils.js";
import type { TaskExecutionState } from "./TaskExecutionState.js";

export async function handleVerify(state: TaskExecutionState): Promise<any> {
    const verifyTargetPath = resolveTargetPath(state.targetFiles, state.paths, state.targetPath);
    const { verification, reasons } = await buildVerificationResult(state.context, { targetPath: verifyTargetPath, draftId: state.draftId });
    const degradedReasons = buildDegradedReasons(reasons, {
        filePath: verification.relPath ?? verification.targetPath
    });
    const isBlocked = reasons.includes("file_missing") || reasons.includes("draft_missing");
    const status = reasons.length === 0 ? "success" : (isBlocked ? "blocked" : "partial_success");
    const summary = buildVerifySummary({ request: state.request, verification });
    const guidance = rewriteGuidanceForCompact({
        guidance: buildGuidance(undefined, state.nextCalls, degradedReasons),
        request: state.request,
        budget: state.budget,
        output: state.outputPayload,
        traceEnabled: state.traceEnabled,
        sessionId: state.sessionId,
        surface: state.surface
    });
    const payload = {
        ok: true,
        sessionId: state.sessionId ?? "unknown",
        status,
        mode: state.routing.mode,
        budget: state.budget,
        surface: state.surface,
        summary,
        verification,
        ...(reasons.length > 0 ? { degraded: true } : {}),
        ...(degradedReasons ? { degradedReasons } : {}),
        ...(guidance ? { guidance } : {}),
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
