import { buildEvidencePackFromExplore, buildEvidencePackFromUnderstand } from "../../orchestration/task/TaskEvidenceBuilder.js";
import { buildDegradedReasons } from "../../orchestration/DegradedReasonMapper.js";
import { buildExploreDecisionGate, buildAnalyzeDecisionGate, mergeDegradedReasons } from "./TaskDecisionUtils.js";
import { buildExploreSummary, buildInlineEvidence, resolveTaskLod } from "./TaskSummaryUtils.js";
import { buildGuidance, buildEvidenceContinuation, rewriteGuidanceForCompact, mapStatus } from "./TaskGuidanceUtils.js";
import { finalizeTaskResponse } from "./TaskResponseUtils.js";
import { recordTaskMetrics, storeEvidencePack } from "./TaskMetricsUtils.js";
import { buildFileVersionsSnapshot } from "./TaskVerificationUtils.js";
import type { TaskExecutionState } from "./TaskExecutionState.js";

export async function handleFallback(state: TaskExecutionState): Promise<any> {
    const response = await state.executePillar("explore", {
        query: state.request,
        paths: state.paths.length > 0 ? state.paths : undefined,
        targetFiles: state.targetFiles.length > 0 ? state.targetFiles : undefined,
        sessionId: state.sessionId,
        profile: state.profile,
        view: "preview",
        trace: state.traceEnabled,
        limits: state.responseLimits
    });
    const exploreEvidencePack = buildEvidencePackFromExplore({
        response,
        request: state.request,
        budgetPolicy: state.budgetPolicy,
        intentCategory: state.routing.category
    });
    const relatedArtifacts = response?.researchPack?.id
        ? [{ id: response.researchPack.id, kind: "research", detail: "summary" as const }]
        : undefined;
    exploreEvidencePack.relatedArtifacts = relatedArtifacts ?? exploreEvidencePack.relatedArtifacts;
    const decisionGate = buildExploreDecisionGate({
        response,
        budgetPolicy: state.budgetPolicy,
        request: state.request,
        budget: state.budget,
        sessionId: state.sessionId,
        targetFiles: state.targetFiles
    });
    let understandResponse: any | undefined;
    let analyzeDecisionGate: { insufficient: boolean; reasons?: string[]; nextCalls?: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> } | undefined;
    const topTarget = state.targetFiles[0]
        ?? response?.data?.code?.[0]?.filePath
        ?? response?.data?.docs?.[0]?.filePath;
    if (decisionGate.insufficient && state.budgetPolicy.maxSteps >= 2 && topTarget) {
        understandResponse = await state.executePillar("understand", {
            goal: state.request,
            targetFiles: [topTarget],
            sessionId: state.sessionId,
            profile: state.profile,
            trace: state.traceEnabled,
            limits: state.responseLimits
        });
        analyzeDecisionGate = buildAnalyzeDecisionGate({
            response: understandResponse,
            budgetPolicy: state.budgetPolicy,
            request: state.request,
            budget: state.budget,
            sessionId: state.sessionId,
            targetFiles: state.targetFiles,
            paths: state.paths
        });
    }
    if (state.traceBuilder) {
        state.traceBuilder.recordEvent({
            area: "policy",
            code: "task.decision_gate",
            data: {
                mode: "ask",
                insufficient: decisionGate.insufficient,
                codeCount: response?.data?.code?.length ?? 0,
                docCount: response?.data?.docs?.length ?? 0
            }
        });
        if (understandResponse) {
            state.traceBuilder.recordEvent({
                area: "policy",
                code: "task.composite_flow",
                data: {
                    steps: ["explore", "understand"],
                    reason: "decision_gate_insufficient"
                }
            });
        }
    }
    const summary = buildExploreSummary({ response, request: state.request, routingNote: state.routingNote });
    if (decisionGate.insufficient) {
        summary.bullets.push("Decision gate: insufficient evidence; add explicit paths/targets or retry with follow-up guidance.");
        summary.next.push("Provide explicit paths/targetFiles to improve evidence quality.");
    }
    if (understandResponse) {
        const analysisLine = typeof understandResponse?.summary === "string"
            ? understandResponse.summary
            : (typeof understandResponse?.primaryFile === "string" ? `Primary file: ${understandResponse.primaryFile}.` : "Analysis completed.");
        summary.bullets.push(`Deep analysis: ${analysisLine}`);
    }
    const combinedNextCalls = [
        ...(state.nextCalls ?? []),
        ...(decisionGate.nextCalls ?? [])
    ];
    if (analyzeDecisionGate?.nextCalls?.length) {
        combinedNextCalls.push(...analyzeDecisionGate.nextCalls);
    }
    const degradedReasons = mergeDegradedReasons(
        response?.degradedReasons,
        decisionGate.reasons ? buildDegradedReasons(decisionGate.reasons) : undefined,
        analyzeDecisionGate?.reasons ? buildDegradedReasons(analyzeDecisionGate.reasons) : undefined
    );
    const decisionInsufficient = decisionGate.insufficient || analyzeDecisionGate?.insufficient;
    const guidance = rewriteGuidanceForCompact({
        guidance: buildGuidance(
            response?.guidance,
            combinedNextCalls.length > 0 ? combinedNextCalls : undefined,
            degradedReasons
        ),
        request: state.request,
        budget: state.budget,
        output: state.outputPayload,
        traceEnabled: state.traceEnabled,
        sessionId: state.sessionId,
        surface: state.surface
    });
    const packId = response?.pack?.packId ?? response?.researchPack?.id;
    const evidencePack = understandResponse
        ? (() => {
            const summaryLine = typeof understandResponse?.summary === "string"
                ? understandResponse.summary
                : `Analysis for "${state.request}".`;
            const analysisPack = buildEvidencePackFromUnderstand({
                primaryFile: typeof understandResponse?.primaryFile === "string" ? understandResponse.primaryFile : undefined,
                summary: summaryLine,
                request: state.request,
                budgetPolicy: state.budgetPolicy,
                relatedArtifacts: understandResponse?.callGraphArtifactId
                    ? [{ id: understandResponse.callGraphArtifactId, kind: "call_graph", detail: "summary" }]
                    : undefined
            });
            return {
                ...analysisPack,
                rankedFiles: exploreEvidencePack.rankedFiles.length > 0 ? exploreEvidencePack.rankedFiles : analysisPack.rankedFiles,
                evidence: [...analysisPack.evidence, ...exploreEvidencePack.evidence].slice(0, state.budgetPolicy.maxEvidenceItems),
                relatedArtifacts: [
                    ...(analysisPack.relatedArtifacts ?? []),
                    ...(exploreEvidencePack.relatedArtifacts ?? [])
                ]
            };
        })()
        : exploreEvidencePack;
    let evidenceArtifactId: string | undefined;
    if (degradedReasons) {
        evidencePack.degradedReasons = degradedReasons;
    }
    if (response?.degraded !== undefined || decisionInsufficient) {
        evidencePack.degraded = Boolean(response?.degraded) || Boolean(decisionInsufficient);
    }
    if (decisionInsufficient) {
        const continuation = buildEvidenceContinuation({
            reason: "insufficient_evidence",
            nextCalls: combinedNextCalls,
            defaults: {
                request: state.request,
                budget: state.budget,
                output: state.outputPayload,
                traceEnabled: state.traceEnabled,
                sessionId: state.sessionId
            }
        });
        if (continuation) {
            evidencePack.continuation = continuation;
        }
    }
    const lodResolution = resolveTaskLod({
        defaultLod: state.budgetPolicy.defaultLod,
        evidencePack,
        hasEvidenceArtifact: state.budgetPolicy.defaultLod >= 3,
        decisionInsufficient
    });
    if (lodResolution.lod >= 3) {
        const fileVersions = await buildFileVersionsSnapshot(
            state.context,
            evidencePack.rankedFiles.map((item) => item.filePath)
        );
        if (fileVersions) {
            evidencePack.fileVersions = fileVersions;
        }
        evidenceArtifactId = storeEvidencePack(state.context, {
            pack: evidencePack,
            sessionId: understandResponse?.sessionId ?? response?.sessionId ?? state.sessionId,
            intent: state.request
        });
    }
    if (state.traceBuilder) {
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
    const artifacts: Array<{ id: string; kind: string; detail: "summary" | "full" }> = [];
    if (understandResponse?.callGraphArtifactId) {
        artifacts.push({ id: understandResponse.callGraphArtifactId, kind: "call_graph", detail: "summary" });
    }
    if (evidenceArtifactId) {
        artifacts.push({ id: evidenceArtifactId, kind: "evidence", detail: "summary" });
    }
    const details = state.outputFormat === "standard"
        ? (understandResponse ? { pillar: "explore", response, followUp: { pillar: "understand", response: understandResponse } } : { pillar: "explore", response })
        : undefined;
    const inlineEvidence = buildInlineEvidence({ lod: lodResolution.lod, evidencePack });
    const payload = {
        ok: true,
        sessionId: understandResponse?.sessionId ?? response?.sessionId ?? state.sessionId,
        status: decisionInsufficient ? "partial_success" : mapStatus(understandResponse ?? response),
        mode: state.routing.mode,
        budget: state.budget,
        surface: state.surface,
        summary,
        ...(inlineEvidence ? { evidence: inlineEvidence } : {}),
        ...(details ? { details } : {}),
        ...(packId ? { packId } : {}),
        ...(artifacts.length > 0 ? { artifacts } : {}),
        ...(response?.degraded !== undefined || decisionInsufficient ? { degraded: Boolean(response?.degraded) || decisionInsufficient } : {}),
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
