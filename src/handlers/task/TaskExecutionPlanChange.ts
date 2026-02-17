import { buildEvidencePackFromExplore } from "../../orchestration/task/TaskEvidenceBuilder.js";
import { buildInlineEvidence, buildPlanPrepSummary, buildTargetStringCandidates, inferReplacementFromRequest, resolveTaskLod, buildApplySummary, buildPlanSummary } from "./TaskSummaryUtils.js";
import { buildGuidance, rewriteGuidanceForCompact, mapStatus } from "./TaskGuidanceUtils.js";
import { finalizeTaskResponse } from "./TaskResponseUtils.js";
import { recordTaskMetrics, storeEvidencePack } from "./TaskMetricsUtils.js";
import { buildFileVersionsSnapshot } from "./TaskVerificationUtils.js";
import { isSmallAutoApplyCandidate, isTaskAutoApplyEnabled, mergePillarArgs, pickPillarOptions } from "./TaskRoutingUtils.js";
import type { TaskExecutionState } from "./TaskExecutionState.js";

export async function handlePlanChange(state: TaskExecutionState): Promise<any> {
    const planTargets = state.targetFiles.length > 0
        ? state.targetFiles
        : (state.targetPath ? [state.targetPath] : (state.paths.length > 0 ? state.paths : []));
    const planLimits = state.responseLimits;
    const exploreOptions = pickPillarOptions("explore", state.pillarOptions);
    const changeOptions = pickPillarOptions("change", state.pillarOptions);
    if (state.edits.length === 0) {
        const response = await state.executePillar("explore", mergePillarArgs({
            query: state.request,
            paths: state.paths.length > 0 ? state.paths : undefined,
            targetFiles: planTargets.length > 0 ? planTargets : undefined,
            sessionId: state.sessionId,
            profile: state.profile,
            view: "preview",
            trace: state.traceEnabled,
            limits: planLimits
        }, exploreOptions, ["query", "paths", "targetFiles", "sessionId", "profile", "view", "trace"]));
        const packId = response?.pack?.packId ?? response?.researchPack?.id;
        const codeTargets = response?.data?.code
            ?.map((item: any) => item?.filePath)
            .filter((filePath: any) => typeof filePath === "string") ?? [];
        const recommendedTargets = Array.from(new Set([...planTargets, ...codeTargets])).slice(0, 10);
        const fileVersions = await buildFileVersionsSnapshot(state.context, recommendedTargets);
        const editsTemplate = {
            edits: [
                {
                    filePath: recommendedTargets[0] ?? "<path>",
                    targetString: "<exact text>",
                    replacementString: "<replacement>"
                }
            ]
        };
        const evidencePack = buildEvidencePackFromExplore({
            response,
            request: state.request,
            budgetPolicy: state.budgetPolicy,
            intentCategory: state.routing.category
        });
        const evidenceFileVersions = await buildFileVersionsSnapshot(
            state.context,
            evidencePack.rankedFiles.map((item) => item.filePath)
        );
        if (evidenceFileVersions) {
            evidencePack.fileVersions = evidenceFileVersions;
        }
        let targetStringCandidates = buildTargetStringCandidates({
            evidencePack,
            maxCandidates: Math.min(3, state.budgetPolicy.maxEvidenceItems)
        });
        if ((!targetStringCandidates || targetStringCandidates.length === 0) && state.budgetPolicy.maxSteps >= 2) {
            const maxAnchorFiles = state.budget === "deep" ? 2 : 1;
            const ranked = Array.isArray(evidencePack.rankedFiles) ? evidencePack.rankedFiles : [];
            const anchorTargets = ranked
                .map((item) => item.filePath)
                .filter((filePath) => {
                    const lower = filePath.toLowerCase();
                    return !lower.endsWith(".md") && !lower.endsWith(".mdx");
                })
                .slice(0, maxAnchorFiles);
            if (anchorTargets.length > 0) {
                try {
                    const anchorResponse = await state.executePillar("explore", mergePillarArgs({
                        paths: anchorTargets,
                        sessionId: state.sessionId,
                        profile: "lean",
                        view: "full",
                        trace: state.traceEnabled,
                        limits: { maxBytes: 200000, maxChars: 20000 }
                    }, exploreOptions, ["paths", "sessionId", "profile", "view", "trace"]));
                    const anchorPack = buildEvidencePackFromExplore({
                        response: anchorResponse,
                        request: state.request,
                        budgetPolicy: state.budgetPolicy,
                        intentCategory: state.routing.category
                    });
                    for (const item of anchorPack.evidence ?? []) {
                        if (item.kind !== "code" || typeof item.anchorText !== "string") continue;
                        const existing = evidencePack.evidence.find((entry) => entry.filePath === item.filePath && entry.kind === "code");
                        if (existing) {
                            existing.anchorText = item.anchorText;
                            existing.location = item.location;
                        }
                    }
                    const anchoredCandidates = buildTargetStringCandidates({
                        evidencePack: anchorPack,
                        maxCandidates: maxAnchorFiles
                    });
                    const merged = [
                        ...(anchoredCandidates ?? []),
                        ...(targetStringCandidates ?? [])
                    ];
                    if (merged.length > 0) {
                        const seen = new Set<string>();
                        targetStringCandidates = merged.filter((candidate) => {
                            const key = `${candidate.filePath}:${candidate.anchorText}`;
                            if (seen.has(key)) return false;
                            seen.add(key);
                            return true;
                        });
                    }
                } catch {
                    // ignore anchor extraction failures
                }
            }
        }
        const lodResolution = resolveTaskLod({
            defaultLod: state.budgetPolicy.defaultLod,
            evidencePack,
            hasEvidenceArtifact: state.budgetPolicy.defaultLod >= 3
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
                code: "task.lod",
                data: {
                    defaultLod: state.budgetPolicy.defaultLod,
                    resolvedLod: lodResolution.lod,
                    reason: lodResolution.reason
                }
            });
        }
        const summary = buildPlanPrepSummary({ request: state.request, recommendedTargets, packId });
        const prepNextCalls: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> = [];
        const seededCandidate = Array.isArray(targetStringCandidates)
            ? targetStringCandidates.find((candidate) => typeof candidate?.filePath === "string" && typeof candidate?.anchorText === "string")
            : undefined;
        const seededTargetString = typeof seededCandidate?.anchorText === "string" ? seededCandidate.anchorText : undefined;
        const inferredReplacement = seededTargetString
            ? inferReplacementFromRequest({ request: state.request, targetString: seededTargetString })
            : undefined;
        const seededEdits = seededCandidate && seededTargetString
            ? [{
                filePath: seededCandidate.filePath,
                targetString: seededTargetString,
                replacementString: inferredReplacement ?? "<replacement>"
            }]
            : (Array.isArray((editsTemplate as any)?.edits) ? (editsTemplate as any).edits : undefined);
        if (Array.isArray(seededEdits) && seededEdits.length > 0) {
            prepNextCalls.push({
                tool: "task",
                args: {
                    request: state.request,
                    mode: "plan_change",
                    budget: state.budget,
                    sessionId: response?.sessionId ?? state.sessionId,
                    targetFiles: typeof seededCandidate?.filePath === "string"
                        ? [seededCandidate.filePath]
                        : (recommendedTargets.length > 0 ? [recommendedTargets[0]] : undefined),
                    edits: seededEdits,
                    ...(state.outputPayload ? { output: state.outputPayload } : {}),
                    ...(state.traceEnabled ? { trace: true } : {})
                },
                reason: inferredReplacement
                    ? "Attempt a best-effort plan based on the inferred replacement."
                    : "Draft a plan with an explicit edit (fill in the replacement if needed)."
            });
        }
        if (packId) {
            prepNextCalls.push({
                tool: "manage",
                args: { command: "artifact", target: packId, detail: "summary" },
                reason: "Inspect the explore pack artifact."
            });
        }
        const combinedNextCalls = [
            ...prepNextCalls,
            ...(Array.isArray(state.nextCalls) ? state.nextCalls : [])
        ];
        const guidance = rewriteGuidanceForCompact({
            guidance: buildGuidance(
                response?.guidance,
                combinedNextCalls.length > 0 ? combinedNextCalls : undefined,
                response?.degradedReasons
            ),
            request: state.request,
            budget: state.budget,
            output: state.outputPayload,
            traceEnabled: state.traceEnabled,
            sessionId: state.sessionId,
            surface: state.surface
        });
        const details = state.outputFormat === "standard" ? { pillar: "explore", response } : undefined;
        const inlineEvidence = buildInlineEvidence({ lod: lodResolution.lod, evidencePack });
        const artifacts: Array<{ id: string; kind: string; detail: "summary" | "full" }> = [];
        if (evidenceArtifactId) {
            artifacts.push({ id: evidenceArtifactId, kind: "evidence", detail: "summary" });
        }
        const payload = {
            ok: true,
            sessionId: response?.sessionId ?? state.sessionId,
            status: "success",
            prepRequired: true,
            prepKind: "missing_edits",
            mode: state.routing.mode,
            budget: state.budget,
            surface: state.surface,
            summary,
            ...(inlineEvidence ? { evidence: inlineEvidence } : {}),
            ...(details ? { details } : {}),
            ...(packId ? { packId } : {}),
            changePrep: {
                recommendedTargets,
                ...(fileVersions ? { fileVersions } : {}),
                editsTemplate,
                ...(targetStringCandidates ? { targetStringCandidates } : {})
            },
            ...(artifacts.length > 0 ? { artifacts } : {}),
            ...(response?.degraded !== undefined ? { degraded: response.degraded } : {}),
            ...(response?.degradedReasons ? { degradedReasons: response.degradedReasons } : {}),
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

    const response = await state.executePillar("change", mergePillarArgs({
        intent: state.request,
        targetFiles: planTargets.length > 0 ? planTargets : undefined,
        edits: state.edits,
        sessionId: state.sessionId,
        profile: state.profile,
        safety: "plan",
        trace: state.traceEnabled,
        ...(typeof state.args?.refinement === "string" ? { refinement: state.args.refinement } : {}),
        ...(state.draftId ? { draftId: state.draftId } : {}),
        ...(planLimits ? { limits: planLimits } : {})
    }, changeOptions, ["intent", "targetFiles", "sessionId", "profile", "safety", "trace", "draftId"]));
    const summary = buildPlanSummary({ response, request: state.request });
    const draftPackId = response?.draftPack?.id;
    const planApplyToken = typeof response?.applyToken === "string" ? response.applyToken : undefined;
    const applyTokenExpiresAt = typeof response?.applyTokenExpiresAt === "number" ? response.applyTokenExpiresAt : undefined;
    const effectiveSessionId = response?.sessionId ?? state.sessionId;
    const autoApplyRequested = state.safety === "auto";
    const autoApplyEnabled = autoApplyRequested && isTaskAutoApplyEnabled();
    const smallAutoApplyCandidate = autoApplyRequested
        ? isSmallAutoApplyCandidate({ targetFiles: planTargets, edits: state.edits, maxLines: 50 })
        : false;
    const reviewBlocked = response?.review?.status === "blocked"
        || response?.review?.verdict === "block"
        || response?.postReview?.status === "blocked"
        || response?.postReview?.verdict === "block";
    let autoApplySkippedReason: string | undefined;
    if (autoApplyRequested && !autoApplyEnabled) {
        autoApplySkippedReason = "env_disabled";
    } else if (autoApplyRequested && !smallAutoApplyCandidate) {
        autoApplySkippedReason = "not_small_change";
    }
    if (
        autoApplyRequested
        && autoApplyEnabled
        && smallAutoApplyCandidate
        && mapStatus(response) === "success"
        && !reviewBlocked
        && draftPackId
        && planApplyToken
    ) {
        const applyResponse = await state.executePillar("change", mergePillarArgs({
            intent: state.request,
            targetFiles: planTargets.length > 0 ? planTargets : undefined,
            edits: state.edits,
            sessionId: effectiveSessionId,
            profile: state.profile,
            safety: "apply",
            trace: state.traceEnabled,
            ...(typeof state.args?.refinement === "string" ? { refinement: state.args.refinement } : {}),
            draftId: draftPackId,
            applyToken: planApplyToken,
            ...(planLimits ? { limits: planLimits } : {})
        }, changeOptions, ["intent", "targetFiles", "sessionId", "profile", "safety", "trace", "draftId", "applyToken"]));
        const applyStatus = mapStatus(applyResponse);
        if (applyStatus !== "blocked") {
            const autoSummary = buildApplySummary({ response: applyResponse, request: state.request });
            autoSummary.bullets.unshift("Auto apply enabled: planned and applied in one task call.");
            const autoGuidance = rewriteGuidanceForCompact({
                guidance: buildGuidance(
                    applyResponse?.guidance,
                    Array.isArray(state.nextCalls) ? state.nextCalls : undefined,
                    applyResponse?.degradedReasons
                ),
                request: state.request,
                budget: state.budget,
                output: state.outputPayload,
                traceEnabled: state.traceEnabled,
                sessionId: applyResponse?.sessionId ?? effectiveSessionId,
                surface: state.surface
            });
            const autoArtifacts: Array<{ id: string; kind: string; detail: "summary" | "full" }> = [];
            if (draftPackId) {
                autoArtifacts.push({ id: draftPackId, kind: "draft", detail: "summary" });
            }
            if (applyResponse?.review?.id) {
                autoArtifacts.push({ id: applyResponse.review.id, kind: "review", detail: "summary" });
            }
            if (applyResponse?.postReview?.id) {
                autoArtifacts.push({ id: applyResponse.postReview.id, kind: "review", detail: "summary" });
            }
            const autoDetails = state.outputFormat === "standard"
                ? { pillar: "change", response: applyResponse, prep: { pillar: "change", response } }
                : undefined;
            const rollbackId = typeof applyResponse?.transactionId === "string" && applyResponse.transactionId.length > 0
                ? applyResponse.transactionId
                : undefined;
            const autoPayload = {
                ok: true,
                sessionId: applyResponse?.sessionId ?? effectiveSessionId ?? state.sessionId,
                status: applyStatus,
                mode: state.routing.mode,
                budget: state.budget,
                surface: state.surface,
                summary: autoSummary,
                autoApplied: true,
                ...(autoDetails ? { details: autoDetails } : {}),
                ...(draftPackId ? { draftId: draftPackId } : {}),
                ...(rollbackId ? { rollbackId } : {}),
                ...(applyResponse?.rollbackAvailable !== undefined ? { rollbackAvailable: applyResponse.rollbackAvailable } : {}),
                ...(autoArtifacts.length > 0 ? { artifacts: autoArtifacts } : {}),
                ...(applyResponse?.degraded !== undefined ? { degraded: applyResponse.degraded } : {}),
                ...(applyResponse?.degradedReasons ? { degradedReasons: applyResponse.degradedReasons } : {}),
                ...(autoGuidance ? { guidance: autoGuidance } : {}),
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
                response: autoPayload,
                traceBuilder: state.traceBuilder,
                budgetPolicy: state.budgetPolicy,
                maxTokens: state.maxTokens,
                maxChars: state.maxChars
            });
        }
        autoApplySkippedReason = "apply_blocked";
    } else if (autoApplyRequested && mapStatus(response) !== "success") {
        autoApplySkippedReason = "plan_blocked";
    } else if (autoApplyRequested && reviewBlocked) {
        autoApplySkippedReason = "review_blocked";
    } else if (autoApplyRequested && (!draftPackId || !planApplyToken)) {
        autoApplySkippedReason = "missing_apply_token";
    }
    const enhancedNextCalls: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> = Array.isArray(state.nextCalls)
        ? [...state.nextCalls]
        : [];
    if (draftPackId && planApplyToken && effectiveSessionId) {
        enhancedNextCalls.unshift({
            tool: "task",
            args: {
                request: state.request,
                mode: "apply_change",
                budget: state.budget,
                sessionId: effectiveSessionId,
                draftId: draftPackId,
                applyToken: planApplyToken,
                ...(state.outputPayload ? { output: state.outputPayload } : {}),
                ...(state.traceEnabled ? { trace: true } : {})
            },
            reason: "Apply the planned change."
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
    const details = state.outputFormat === "standard" ? { pillar: "change", response } : undefined;
    const payload = {
        ok: true,
        sessionId: response?.sessionId ?? state.sessionId,
        status: mapStatus(response),
        mode: state.routing.mode,
        budget: state.budget,
        surface: state.surface,
        summary,
        ...(details ? { details } : {}),
        ...(autoApplyRequested ? { autoApplied: false } : {}),
        ...(autoApplySkippedReason ? { autoApplySkippedReason } : {}),
        ...(draftPackId ? { draftId: draftPackId } : {}),
        ...(planApplyToken ? { applyToken: planApplyToken } : {}),
        ...(applyTokenExpiresAt ? { applyTokenExpiresAt } : {}),
        ...(artifacts.length > 0 ? { artifacts } : {}),
        ...(response?.degraded !== undefined ? { degraded: response.degraded } : {}),
        ...(response?.degradedReasons ? { degradedReasons: response.degradedReasons } : {}),
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
