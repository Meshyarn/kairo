import { buildDegradedReasons } from "../../orchestration/DegradedReasonMapper.js";
import { loadVerifyExecConfig } from "../../orchestration/verification/VerifyExecConfig.js";
import { runVerifyExec } from "../../orchestration/verification/VerifyExecRunner.js";
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
    const verifyExecArgs = state.args?.verifyExec;
    const verifyExecRequested = verifyExecArgs?.enabled === true;
    const verifyExecIds = Array.isArray(verifyExecArgs?.ids)
        ? verifyExecArgs.ids.filter((id: any) => typeof id === "string")
        : undefined;
    let verifyExecReport: any | undefined;
    if (verifyExecRequested) {
        const envEnabled = (process.env.KAIRO_VERIFY_EXEC_ENABLED ?? "").toLowerCase() === "true";
        const { config, path, error } = loadVerifyExecConfig(state.context.rootPath);
        if (!envEnabled) {
            verifyExecReport = { status: "blocked", reason: "env_disabled", configPath: path };
        } else if (error) {
            verifyExecReport = { status: "blocked", reason: "config_parse_error", configPath: path, error };
        } else if (!config.enabled) {
            verifyExecReport = { status: "blocked", reason: "config_disabled", configPath: path };
        } else {
            const allowed = Array.isArray(config.allowedCommands) ? config.allowedCommands : [];
            const selected = verifyExecIds && verifyExecIds.length > 0
                ? allowed.filter((cmd) => verifyExecIds.includes(cmd.id))
                : allowed;
            if (selected.length === 0) {
                verifyExecReport = {
                    status: "blocked",
                    reason: verifyExecIds && verifyExecIds.length > 0 ? "ids_not_allowed" : "no_allowed_commands",
                    configPath: path
                };
            } else {
                const results = await runVerifyExec({ commands: selected, rootPath: state.context.rootPath });
                verifyExecReport = {
                    status: "ran",
                    results,
                    configPath: path
                };
            }
        }
    }
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
        ...(verifyExecReport ? { verifyExec: verifyExecReport } : {}),
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
