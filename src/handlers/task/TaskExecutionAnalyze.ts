import { buildDegradedReasons } from "../../orchestration/DegradedReasonMapper.js";
import { buildEvidencePackFromUnderstand } from "../../orchestration/task/TaskEvidenceBuilder.js";
import { buildAnalyzeDecisionGate, mergeDegradedReasons } from "./TaskDecisionUtils.js";
import { buildUnderstandSummary, buildInlineEvidence, resolveTaskLod } from "./TaskSummaryUtils.js";
import { buildGuidance, buildEvidenceContinuation, rewriteGuidanceForCompact, mapStatus } from "./TaskGuidanceUtils.js";
import { finalizeTaskResponse } from "./TaskResponseUtils.js";
import { recordTaskMetrics, storeEvidencePack } from "./TaskMetricsUtils.js";
import type { TaskExecutionState } from "./TaskExecutionState.js";

export async function handleAnalyze(state: TaskExecutionState): Promise<any> {
    const response = await state.executePillar("understand", {
        goal: state.request,
        targetFiles: state.targetFiles.length > 0 ? state.targetFiles : undefined,
        sessionId: state.sessionId,
        profile: state.profile,
        trace: state.traceEnabled,
        limits: state.responseLimits
    });
    const relatedArtifacts = response?.callGraphArtifactId
        ? [{ id: response.callGraphArtifactId, kind: "call_graph", detail: "summary" as const }]
        : undefined;
    const summaryLine = typeof response?.summary === "string"
        ? response.summary
        : `Analysis for "${state.request}".`;
    const evidencePack = buildEvidencePackFromUnderstand({
        primaryFile: typeof response?.primaryFile === "string" ? response.primaryFile : undefined,
        summary: summaryLine,
        request: state.request,
        budgetPolicy: state.budgetPolicy,
        relatedArtifacts
    });
    const decisionGate = buildAnalyzeDecisionGate({
        response,
        budgetPolicy: state.budgetPolicy,
        request: state.request,
        budget: state.budget,
        sessionId: state.sessionId,
        targetFiles: state.targetFiles,
        paths: state.paths
    });
    const combinedNextCalls = [
        ...(state.nextCalls ?? []),
        ...(decisionGate.nextCalls ?? [])
    ];
    const packDegradedReasons = mergeDegradedReasons(
        response?.degradedReasons,
        decisionGate.reasons ? buildDegradedReasons(decisionGate.reasons) : undefined
    );
    if (decisionGate.insufficient || response?.degraded !== undefined) {
        evidencePack.degraded = Boolean(response?.degraded) || decisionGate.insufficient;
    }
    if (packDegradedReasons) {
        evidencePack.degradedReasons = packDegradedReasons;
    }
    const continuation = decisionGate.insufficient
        ? buildEvidenceContinuation({
            reason: "insufficient_evidence",
            nextCalls: combinedNextCalls,
            defaults: {
                request: state.request,
                budget: state.budget,
                output: state.outputPayload,
                traceEnabled: state.traceEnabled,
                sessionId: state.sessionId
            }
        })
        : undefined;
    if (continuation) {
        evidencePack.continuation = continuation;
    }
    const lodResolution = resolveTaskLod({
        defaultLod: state.budgetPolicy.defaultLod,
        evidencePack,
        hasEvidenceArtifact: state.budgetPolicy.defaultLod >= 3,
        decisionInsufficient: decisionGate.insufficient
    });
    let evidenceArtifactId: string | undefined;
    if (lodResolution.lod >= 3) {
        evidenceArtifactId = storeEvidencePack(state.context, {
            pack: evidencePack,
            sessionId: response?.sessionId ?? state.sessionId,
            intent: state.request
        });
    }
    if (state.traceBuilder) {
        state.traceBuilder.recordEvent({
            area: "policy",
            code: "task.decision_gate",
            data: {
                mode: "analyze",
                insufficient: decisionGate.insufficient
            }
        });
        state.traceBuilder.recordEvent({
            area: "policy",
            code: "task.lod",
            data: {
                defaultLod: state.budgetPolicy.defaultLod,
                resolvedLod: lodResolution.lod,
                reason: lodResolution.reason
            }
        });
    }
    const summary = buildUnderstandSummary({ response, request: state.request });
    if (decisionGate.insufficient) {
        summary.bullets.push("Decision gate: insufficient evidence; add explicit paths/targets or retry with follow-up guidance.");
    }
    const guidance = rewriteGuidanceForCompact({
        guidance: buildGuidance(response?.guidance, combinedNextCalls.length > 0 ? combinedNextCalls : undefined),
        request: state.request,
        budget: state.budget,
        output: state.outputPayload,
        traceEnabled: state.traceEnabled,
        sessionId: state.sessionId,
        surface: state.surface
    });
    const artifacts: Array<{ id: string; kind: string; detail: "summary" | "full" }> = [];
    if (response?.callGraphArtifactId) {
        artifacts.push({ id: response.callGraphArtifactId, kind: "call_graph", detail: "summary" });
    }
    if (evidenceArtifactId) {
        artifacts.push({ id: evidenceArtifactId, kind: "evidence", detail: "summary" });
    }
    const details = state.outputFormat === "standard" ? { pillar: "understand", response } : undefined;
    const degradedReasons = packDegradedReasons;
    const inlineEvidence = buildInlineEvidence({ lod: lodResolution.lod, evidencePack });
    const payload = {
        ok: true,
        sessionId: response?.sessionId ?? state.sessionId,
        status: decisionGate.insufficient ? "partial_success" : mapStatus(response),
        mode: state.routing.mode,
        budget: state.budget,
        surface: state.surface,
        summary,
        ...(inlineEvidence ? { evidence: inlineEvidence } : {}),
        ...(details ? { details } : {}),
        ...(artifacts.length > 0 ? { artifacts } : {}),
        ...(response?.degraded !== undefined || decisionGate.insufficient ? { degraded: Boolean(response?.degraded) || decisionGate.insufficient } : {}),
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
        traceBuilder: state.traceBuilder,
        lod: {
            defaultLod: state.budgetPolicy.defaultLod,
            resolvedLod: lodResolution.lod,
            evidencePack
        }
    });
    return finalizeTaskResponse({
        response: payload,
        traceBuilder: state.traceBuilder,
        budgetPolicy: state.budgetPolicy,
        maxTokens: state.maxTokens,
        maxChars: state.maxChars
    });
}
