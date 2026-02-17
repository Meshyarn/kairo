import { buildEvidencePackFromExplore } from "../../orchestration/task/TaskEvidenceBuilder.js";
import { buildDegradedReasons } from "../../orchestration/DegradedReasonMapper.js";
import { extractContentFromRequest, mergePillarArgs, pickPillarOptions, resolveTargetPath } from "./TaskRoutingUtils.js";
import { buildWriteSummary, buildInlineEvidence, resolveTaskLod } from "./TaskSummaryUtils.js";
import { buildGuidance, rewriteGuidanceForCompact, mapStatus } from "./TaskGuidanceUtils.js";
import { finalizeTaskResponse } from "./TaskResponseUtils.js";
import { mergeDegradedReasons } from "./TaskDecisionUtils.js";
import { recordTaskMetrics, storeEvidencePack } from "./TaskMetricsUtils.js";
import { buildFileVersionsSnapshot, buildVerificationResult } from "./TaskVerificationUtils.js";
import type { TaskExecutionState } from "./TaskExecutionState.js";

export async function handleWrite(state: TaskExecutionState): Promise<any> {
    const writeSafety = state.safety === "apply" ? "apply" : "plan";
    const writeTargetPath = resolveTargetPath(state.targetFiles, state.paths, state.targetPath);
    const extractedContent = writeSafety === "plan" ? extractContentFromRequest(state.request) : undefined;
    let prepEvidencePack: any | undefined;
    let prepEvidenceArtifactId: string | undefined;
    let prepLodResolution: { lod: number; reason?: string } | undefined;
    if (writeSafety === "plan" && extractedContent === undefined && state.budgetPolicy.maxSteps >= 2) {
        const exploreOptions = pickPillarOptions("explore", state.pillarOptions);
        const exploreResponse = await state.executePillar("explore", mergePillarArgs({
            query: state.request,
            paths: state.paths.length > 0 ? state.paths : undefined,
            targetFiles: writeTargetPath ? [writeTargetPath] : undefined,
            sessionId: state.sessionId,
            profile: state.profile,
            view: "preview",
            trace: state.traceEnabled,
            limits: state.responseLimits
        }, exploreOptions, ["query", "paths", "targetFiles", "sessionId", "profile", "view", "trace"]));
        const relatedArtifacts = exploreResponse?.researchPack?.id
            ? [{ id: exploreResponse.researchPack.id, kind: "research", detail: "summary" as const }]
            : undefined;
        prepEvidencePack = buildEvidencePackFromExplore({
            response: exploreResponse,
            request: state.request,
            budgetPolicy: state.budgetPolicy,
            intentCategory: state.routing.category,
            relatedArtifacts
        });
        prepLodResolution = resolveTaskLod({
            defaultLod: state.budgetPolicy.defaultLod,
            evidencePack: prepEvidencePack,
            hasEvidenceArtifact: state.budgetPolicy.defaultLod >= 3
        });
        if (prepLodResolution.lod >= 3) {
            const fileVersions = await buildFileVersionsSnapshot(
                state.context,
                prepEvidencePack.rankedFiles.map((item: { filePath: string }) => item.filePath)
            );
            if (fileVersions) {
                prepEvidencePack.fileVersions = fileVersions;
            }
            prepEvidenceArtifactId = storeEvidencePack(state.context, {
                pack: prepEvidencePack,
                sessionId: exploreResponse?.sessionId ?? state.sessionId,
                intent: state.request
            });
        }
        if (state.traceBuilder) {
            state.traceBuilder.recordEvent({
                area: "policy",
                code: "task.composite_flow",
                data: {
                    steps: ["explore", "write"],
                    reason: "write_plan_prep"
                }
            });
            state.traceBuilder.recordEvent({
                area: "policy",
                code: "task.lod",
                data: {
                    defaultLod: state.budgetPolicy.defaultLod,
                    resolvedLod: prepLodResolution.lod,
                    reason: prepLodResolution.reason
                }
            });
        }
    }
    const writeOptions = pickPillarOptions("write", state.pillarOptions);
    const response = await state.executePillar("write", mergePillarArgs({
        intent: state.request,
        targetPath: writeTargetPath,
        ...(extractedContent !== undefined ? { content: extractedContent } : {}),
        ...(extractedContent === undefined && writeSafety === "plan" ? { smartWrite: true } : {}),
        sessionId: state.sessionId,
        profile: state.profile,
        trace: state.traceEnabled,
        safety: writeSafety,
        ...(state.draftId ? { draftId: state.draftId } : {}),
        ...(state.applyToken ? { applyToken: state.applyToken } : {}),
        ...(typeof state.args?.refinement === "string" ? { refinement: state.args.refinement } : {}),
        ...(state.responseLimits ? { limits: state.responseLimits } : {})
    }, writeOptions, ["intent", "targetPath", "sessionId", "profile", "trace", "safety", "draftId", "applyToken"]));
    const summary = buildWriteSummary({ response, request: state.request });
    let status = mapStatus(response);
    let verification: any | undefined;
    let verificationReasons: string[] = [];
    const writeDraftId = (typeof response?.draftPack?.id === "string" ? response.draftPack.id : undefined)
        ?? state.draftId;
    const autoVerifyTargetPath = (typeof response?.targetPath === "string" ? response.targetPath : undefined)
        ?? (typeof response?.targetFile === "string" ? response.targetFile : undefined)
        ?? (Array.isArray(response?.createdFiles) ? response.createdFiles[0]?.path : undefined)
        ?? writeTargetPath;
    const canAutoVerify = writeSafety === "apply"
        && status === "success"
        && state.budgetPolicy.maxSteps >= 2
        && Boolean(autoVerifyTargetPath)
        && Boolean(writeDraftId)
        && Boolean(state.context.fileSystem)
        && Boolean(state.context.flowArtifactManager);
    if (canAutoVerify) {
        const result = await buildVerificationResult(state.context, {
            targetPath: autoVerifyTargetPath,
            draftId: writeDraftId
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
    const inlineEvidence = prepEvidencePack && prepLodResolution
        ? buildInlineEvidence({ lod: prepLodResolution.lod, evidencePack: prepEvidencePack })
        : undefined;
    if (inlineEvidence?.length) {
        summary.bullets.push("Prep evidence: similar files and snippets gathered for write planning.");
    }
    const draftPackId = response?.draftPack?.id;
    const writeApplyToken = typeof response?.applyToken === "string" ? response.applyToken : undefined;
    const applyTokenExpiresAt = typeof response?.applyTokenExpiresAt === "number" ? response.applyTokenExpiresAt : undefined;
    const effectiveSessionId = response?.sessionId ?? state.sessionId;
    const enhancedNextCalls: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> = Array.isArray(state.nextCalls)
        ? [...state.nextCalls]
        : [];
    if (writeSafety === "plan" && draftPackId && writeApplyToken && effectiveSessionId) {
        enhancedNextCalls.unshift({
            tool: "task",
            args: {
                request: state.request,
                mode: "write",
                safety: "apply",
                budget: state.budget,
                sessionId: effectiveSessionId,
                draftId: draftPackId,
                applyToken: writeApplyToken,
                ...(state.outputPayload ? { output: state.outputPayload } : {}),
                ...(state.traceEnabled ? { trace: true } : {})
            },
            reason: "Apply the planned write."
        });
    }
    const guidance = rewriteGuidanceForCompact({
        guidance: buildGuidance(
            response?.guidance,
            enhancedNextCalls.length > 0 ? enhancedNextCalls : undefined,
            response?.degradedReasons
        ),
        request: state.request,
        budget: state.budget,
        output: state.outputPayload,
        traceEnabled: state.traceEnabled,
        sessionId: effectiveSessionId,
        surface: state.surface
    });
    const artifacts: Array<{ id: string; kind: string; detail: "summary" | "full" }> = [];
    if (draftPackId) {
        artifacts.push({ id: draftPackId, kind: "draft", detail: "summary" });
    }
    if (response?.review?.id) {
        artifacts.push({ id: response.review.id, kind: "review", detail: "summary" });
    }
    if (response?.postReview?.id) {
        artifacts.push({ id: response.postReview.id, kind: "review", detail: "summary" });
    }
    if (prepEvidenceArtifactId) {
        artifacts.push({ id: prepEvidenceArtifactId, kind: "evidence", detail: "summary" });
    }
    const details = state.outputFormat === "standard" ? { pillar: "write", response } : undefined;
    const verifyDegradedReasons = verificationReasons.length > 0
        ? buildDegradedReasons(verificationReasons, { filePath: verification?.relPath ?? verification?.targetPath })
        : undefined;
    const degradedReasons = mergeDegradedReasons(response?.degradedReasons, verifyDegradedReasons);
    const degraded = Boolean(response?.degraded) || verificationReasons.length > 0;
    const payload = {
        ok: true,
        sessionId: response?.sessionId ?? state.sessionId,
        status,
        mode: state.routing.mode,
        budget: state.budget,
        surface: state.surface,
        summary,
        ...(inlineEvidence ? { evidence: inlineEvidence } : {}),
        ...(details ? { details } : {}),
        ...(draftPackId ? { draftId: draftPackId } : {}),
        ...(writeApplyToken ? { applyToken: writeApplyToken } : {}),
        ...(applyTokenExpiresAt ? { applyTokenExpiresAt } : {}),
        ...(artifacts.length > 0 ? { artifacts } : {}),
        ...(verification ? { verification } : {}),
        ...(response?.degraded !== undefined || verificationReasons.length > 0 ? { degraded } : {}),
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
        ...(prepEvidencePack && prepLodResolution
            ? {
                lod: {
                    defaultLod: state.budgetPolicy.defaultLod,
                    resolvedLod: prepLodResolution.lod,
                    evidencePack: prepEvidencePack
                }
            }
            : {})
    });
    return finalizeTaskResponse({
        response: payload,
        traceBuilder: state.traceBuilder,
        budgetPolicy: state.budgetPolicy,
        maxTokens: state.maxTokens,
        maxChars: state.maxChars
    });
}
