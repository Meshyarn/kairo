import type { ExploreResponse } from "../../orchestration/pillars/explore/ResultFormatter.js";
import type { TaskEvidencePack } from "../../types/flow-artifacts.js";
import type { VerificationResult } from "./TaskTypes.js";

export const buildExploreSummary = (args: {
    response: ExploreResponse;
    request: string;
    routingNote?: string;
}): { title: string; bullets: string[]; next: string[] } => {
    const response = args.response;
    const docsCount = response?.data?.docs?.length ?? 0;
    const codeCount = response?.data?.code?.length ?? 0;
    const status = response?.status ?? (response?.success === false ? "blocked" : "success");
    const topCode = response?.data?.code?.slice(0, 3).map((item) => item.filePath).filter(Boolean) ?? [];
    const topDocs = response?.data?.docs?.slice(0, 3).map((item) => item.filePath).filter(Boolean) ?? [];
    const bullets = [
        `Results: ${codeCount} code, ${docsCount} docs (status=${status}).`,
        topCode.length > 0 ? `Top code: ${topCode.join(", ")}.` : "Top code: none.",
        topDocs.length > 0 ? `Top docs: ${topDocs.join(", ")}.` : "Top docs: none."
    ];
    if (args.routingNote) {
        bullets.push(args.routingNote);
    }
    const next: string[] = [];
    if (response?.pack?.packId) {
        next.push("Use manage artifact/export to inspect the explore pack.");
    }
    return {
        title: `Explore results for "${args.request}".`,
        bullets,
        next
    };
};

export const buildUnderstandSummary = (args: {
    response: any;
    request: string;
}): { title: string; bullets: string[]; next: string[] } => {
    const response = args.response ?? {};
    const primaryFile = typeof response.primaryFile === "string" ? response.primaryFile : "unknown";
    const symbols = Array.isArray(response.symbols) ? response.symbols.length : 0;
    const deps = Array.isArray(response.dependencies) ? response.dependencies.length : 0;
    const summaryLine = typeof response.summary === "string" ? response.summary : `Analysis for "${args.request}".`;
    const bullets = [
        summaryLine,
        `Primary file: ${primaryFile}.`,
        `Signals: symbols=${symbols}, dependencies=${deps}.`
    ];
    const next: string[] = [];
    if (response.callGraphArtifactId) {
        next.push("Use manage artifact to review the call graph summary.");
    }
    return {
        title: `Analysis results for "${args.request}".`,
        bullets,
        next
    };
};

export const buildInlineEvidence = (args: {
    lod: number;
    evidencePack?: TaskEvidencePack;
}): Array<{ filePath: string; reason?: string; excerpt?: string; kind?: string; source?: string; score?: number }> | undefined => {
    const pack = args.evidencePack;
    if (!pack || args.lod <= 0) return undefined;
    if (args.lod === 1) {
        const ranked = Array.isArray(pack.rankedFiles) ? pack.rankedFiles : [];
        if (ranked.length === 0) return undefined;
        return ranked.map((item) => ({
            filePath: item.filePath,
            reason: item.reason,
            score: item.score
        }));
    }
    const evidence = Array.isArray(pack.evidence) ? pack.evidence : [];
    if (evidence.length === 0) return undefined;
    return evidence.map((item) => ({
        filePath: item.filePath,
        reason: item.reason,
        excerpt: item.excerpt,
        kind: item.kind,
        source: item.source,
        score: item.score
    }));
};

export const buildTargetStringCandidates = (args: {
    evidencePack?: TaskEvidencePack;
    maxCandidates: number;
}): Array<{ filePath: string; anchorText: string; reason?: string; location?: { lineStart?: number; lineEnd?: number } }> | undefined => {
    const pack = args.evidencePack;
    if (!pack) return undefined;
    const evidence = Array.isArray(pack.evidence) ? pack.evidence : [];
    const candidates = evidence
        .filter((item) => item.kind === "code" && typeof item.anchorText === "string" && item.anchorText.length > 0)
        .map((item) => ({
            filePath: item.filePath,
            anchorText: item.anchorText!,
            reason: item.reason,
            ...(item.location ? { location: item.location } : {})
        }))
        .slice(0, Math.max(0, args.maxCandidates));
    return candidates.length > 0 ? candidates : undefined;
};

export const resolveTaskLod = (args: {
    defaultLod: number;
    evidencePack?: TaskEvidencePack;
    hasEvidenceArtifact: boolean;
    decisionInsufficient?: boolean;
}): { lod: number; reason?: string } => {
    const rankedFiles = args.evidencePack?.rankedFiles ?? [];
    const evidenceItems = args.evidencePack?.evidence ?? [];
    let lod = args.defaultLod;
    let reason: string | undefined;
    if (rankedFiles.length === 0) {
        lod = 0;
        reason = "no_ranked_files";
    } else if (!args.hasEvidenceArtifact && rankedFiles.length < 2 && args.defaultLod >= 2) {
        lod = 1;
        reason = "low_ranked_files";
    }
    if (!args.hasEvidenceArtifact && evidenceItems.length === 0 && lod >= 2) {
        lod = 1;
        reason = "no_evidence";
    }
    if (!args.hasEvidenceArtifact && lod >= 3) {
        lod = 2;
        reason = "artifact_budget_disabled";
    }
    if (args.decisionInsufficient && !args.hasEvidenceArtifact) {
        lod = 1;
        reason = "decision_insufficient";
    }
    return { lod, reason };
};

export const buildPlanPrepSummary = (args: {
    request: string;
    recommendedTargets: string[];
    packId?: string;
}): { title: string; bullets: string[]; next: string[] } => {
    const recommended = args.recommendedTargets.length > 0
        ? args.recommendedTargets.slice(0, 5).join(", ")
        : "none";
    const bullets = [
        `Recommended targets: ${recommended}.`,
        "Provide explicit edits to generate a change plan."
    ];
    const next: string[] = [];
    if (args.packId) {
        next.push("Use manage artifact/export to inspect the explore pack.");
    }
    next.push("Call task with mode=plan_change and edits to generate a DraftPack.");
    return {
        title: `Change prep for "${args.request}".`,
        bullets,
        next
    };
};

export const inferReplacementFromRequest = (args: { request: string; targetString: string }): string | undefined => {
    const request = String(args.request ?? "").replace(/\s+/g, " ").trim();
    if (!request) return undefined;
    const targetString = String(args.targetString ?? "");
    if (!targetString) return undefined;

    const patterns: RegExp[] = [
        /from\s+["'`]?(.+?)["'`]?\s+to\s+["'`]?(.+?)["'`]?(?:[.?!]|$)/i,
        /rename\s+["'`]?(.+?)["'`]?\s+to\s+["'`]?(.+?)["'`]?(?:[.?!]|$)/i,
        /replace\s+["'`]?(.+?)["'`]?\s+with\s+["'`]?(.+?)["'`]?(?:[.?!]|$)/i
    ];

    for (const pattern of patterns) {
        const match = request.match(pattern);
        if (!match) continue;
        const from = match[1]?.trim();
        const to = match[2]?.trim();
        if (!from || !to) continue;
        if (!targetString.includes(from)) continue;
        const replaced = targetString.replace(from, to);
        if (replaced !== targetString) {
            return replaced;
        }
    }
    return undefined;
};

export const buildPlanSummary = (args: {
    response: any;
    request: string;
}): { title: string; bullets: string[]; next: string[] } => {
    const response = args.response ?? {};
    const draftId = response?.draftPack?.id ?? "none";
    const reviewId = response?.review?.id ?? "none";
    const impact = response?.impactReport ? "present" : "none";
    const diffBytes = typeof response?.diff === "string" ? response.diff.length : 0;
    const bullets = [
        `Draft pack: ${draftId}.`,
        `Review: ${reviewId}.`,
        `Impact: ${impact}.`,
        `Diff bytes: ${diffBytes}.`
    ];
    const next: string[] = [];
    if (draftId !== "none") {
        next.push("Use manage artifact to review the draft pack.");
    }
    if (reviewId !== "none") {
        next.push("Use manage artifact to review the pre-apply review.");
    }
    return {
        title: `Change plan for "${args.request}".`,
        bullets,
        next
    };
};

export const buildApplySummary = (args: {
    response: any;
    request: string;
}): { title: string; bullets: string[]; next: string[] } => {
    const response = args.response ?? {};
    const targetFile = typeof response?.targetFile === "string"
        ? response.targetFile
        : (typeof response?.targetPath === "string" ? response.targetPath : "unknown");
    const status = response?.status ?? "ok";
    const rollback = response?.rollbackAvailable ? "yes" : "no";
    const reviewId = response?.postReview?.id ?? response?.review?.id ?? "none";
    const bullets = [
        `Target: ${targetFile}.`,
        `Status: ${status}.`,
        `Rollback available: ${rollback}.`,
        `Review: ${reviewId}.`
    ];
    const next: string[] = [];
    if (reviewId !== "none") {
        next.push("Use manage artifact to review the apply review.");
    }
    if (rollback === "yes") {
        next.push("Use manage history to inspect or rollback.");
    }
    return {
        title: `Change apply result for "${args.request}".`,
        bullets,
        next
    };
};

export const buildWriteSummary = (args: {
    response: any;
    request: string;
}): { title: string; bullets: string[]; next: string[] } => {
    const response = args.response ?? {};
    const targetFile = typeof response?.targetPath === "string"
        ? response.targetPath
        : (typeof response?.targetFile === "string" ? response.targetFile : (response?.createdFiles?.[0]?.path ?? "unknown"));
    const status = response?.status ?? (response?.success === false ? "blocked" : "success");
    const draftId = response?.draftPack?.id ?? "none";
    const createdCount = Array.isArray(response?.createdFiles) ? response.createdFiles.length : 0;
    const reviewId = response?.review?.id ?? response?.postReview?.id ?? "none";
    const bullets = [
        `Target: ${targetFile}.`,
        `Status: ${status}.`,
        `Draft: ${draftId}.`,
        `Created files: ${createdCount}.`
    ];
    const next: string[] = [];
    if (draftId !== "none") {
        next.push("Use manage artifact to review the draft pack.");
    }
    if (reviewId !== "none") {
        next.push("Use manage artifact to review the write review.");
    }
    return {
        title: `Write result for "${args.request}".`,
        bullets,
        next
    };
};

export const buildVerifySummary = (args: {
    request: string;
    verification: VerificationResult;
}): { title: string; bullets: string[]; next: string[] } => {
    const verification = args.verification;
    const target = verification.relPath ?? verification.targetPath ?? "unknown";
    const exists = verification.exists ? "yes" : "no";
    const contentMatch = verification.contentMatch === undefined
        ? "unknown"
        : (verification.contentMatch ? "match" : "mismatch");
    const versionMatch = verification.fileVersionMatch === undefined
        ? "unknown"
        : (verification.fileVersionMatch ? "match" : "mismatch");
    const bullets = [
        `Target: ${target}.`,
        `Exists: ${exists}.`,
        `Draft match: ${contentMatch}.`,
        `Base version: ${versionMatch}.`
    ];
    const next: string[] = [];
    if (verification.draftId && verification.draftFound) {
        next.push("Use manage artifact to review the draft pack.");
    }
    return {
        title: `Verify result for "${args.request}".`,
        bullets,
        next
    };
};
