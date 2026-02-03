import { estimateTokens } from "../../orchestration/TokenBudget.js";
import { resolveEnvelopeMaxTokens } from "../../orchestration/policy/McpModePresetRegistry.js";
import type { FlowArtifact, GraphPack, TaskEvidencePack } from "../../types/flow-artifacts.js";
import { parseNumberEnv } from "./ManageStatusUtils.js";

export const resolveManageEnvelopeBudget = (args: any): { maxTokens?: number; maxChars?: number } => {
    const limits = args?.limits ?? {};
    const policyMaxTokens = resolveEnvelopeMaxTokens("manage");
    const maxTokens = Number.isFinite(limits.maxTokens) && limits.maxTokens > 0
        ? limits.maxTokens
        : policyMaxTokens;
    const maxChars = Number.isFinite(limits.maxChars) && limits.maxChars > 0
        ? limits.maxChars
        : parseNumberEnv(process.env.KAIRO_MANAGE_MAX_CHARS, NaN);
    return {
        maxTokens: Number.isFinite(maxTokens) ? maxTokens : undefined,
        maxChars: Number.isFinite(maxChars) ? maxChars : undefined
    };
};

const estimateResponseUsage = (payload: any): { estimatedTokens: number; usedChars: number } => {
    const serialized = JSON.stringify(payload ?? {});
    return {
        usedChars: serialized.length,
        estimatedTokens: estimateTokens(serialized, { languageId: "json" })
    };
};

const applyGraphViewBudget = (response: any, options: { maxTokens?: number; maxChars?: number }) => {
    const maxTokens = options.maxTokens;
    const maxChars = options.maxChars;
    const hasBudget = Number.isFinite(maxTokens) || Number.isFinite(maxChars);
    if (!hasBudget) {
        return { applied: false, estimatedTokens: 0, usedChars: 0 };
    }

    const withinBudget = (usage: { estimatedTokens: number; usedChars: number }) => {
        const overTokens = Number.isFinite(maxTokens) && maxTokens! > 0 ? usage.estimatedTokens > maxTokens! : false;
        const overChars = Number.isFinite(maxChars) && maxChars! > 0 ? usage.usedChars > maxChars! : false;
        return !overTokens && !overChars;
    };

    let usage = estimateResponseUsage(response);
    if (withinBudget(usage)) {
        return { applied: false, ...usage };
    }

    let applied = false;
    const view = response.view;
    if (view?.graph?.edges?.length) {
        view.graph.edges = [];
        applied = true;
        usage = estimateResponseUsage(response);
    }

    if (!withinBudget(usage) && view?.graph?.nodes?.length) {
        const target = Math.max(1, Math.min(10, view.graph.nodes.length));
        if (view.graph.nodes.length > target) {
            view.graph.nodes = view.graph.nodes.slice(0, target);
            view.graph.edges = [];
            applied = true;
            usage = estimateResponseUsage(response);
        }
    }

    if (!withinBudget(usage) && view?.graph) {
        view.graph = undefined;
        applied = true;
        usage = estimateResponseUsage(response);
    }

    if (applied) {
        response.degraded = true;
        response.reasons = Array.from(new Set([...(response.reasons ?? []), "budget_exceeded"]));
        view.meta = {
            ...(view.meta ?? {}),
            budget: {
                applied: true,
                estimatedTokens: usage.estimatedTokens,
                usedChars: usage.usedChars,
                maxTokens,
                maxChars
            }
        };
    }

    return { applied, ...usage };
};

export const buildGraphArtifactResponse = (
    artifact: FlowArtifact,
    options: { detail: "summary" | "full"; limit?: number; maxTokens?: number; maxChars?: number }
) => {
    const pack = (artifact as any).pack as GraphPack | undefined;
    if (!pack) {
        return {
            success: false,
            output: "Artifact not found."
        };
    }
    const raw = pack.raw ?? { nodes: [], edges: [], resolvedTarget: undefined };
    const caps = pack.meta?.caps ?? {};
    const maxNodes = Number.isFinite(caps.maxNodes) && (caps.maxNodes as number) > 0 ? (caps.maxNodes as number) : 500;
    const maxEdges = Number.isFinite(caps.maxEdges) && (caps.maxEdges as number) > 0 ? (caps.maxEdges as number) : 1500;
    const previewLimit = options.detail === "summary" ? 20 : raw.nodes.length;
    const nodeLimit = Number.isFinite(options.limit) && options.limit! > 0
        ? Math.min(options.limit!, maxNodes)
        : Math.min(previewLimit, maxNodes, raw.nodes.length);
    const edgeLimit = Number.isFinite(options.limit) && options.limit! > 0
        ? Math.min(options.limit! * 3, maxEdges)
        : Math.min(nodeLimit * 3, maxEdges, raw.edges.length);

    const nodes = raw.nodes.slice(0, nodeLimit);
    const nodeIds = new Set(nodes.map((node: any) => node.id));
    const edges = raw.edges.filter((edge: any) => nodeIds.has(edge.source) && nodeIds.has(edge.target)).slice(0, edgeLimit);
    const truncated = nodeLimit < raw.nodes.length || edges.length < raw.edges.length || pack.summary?.truncated === true;

    const view = {
        detail: options.detail,
        summary: pack.summary,
        graph: {
            nodes,
            edges,
            resolvedTarget: raw.resolvedTarget
        },
        meta: {
            truncated,
            totalNodes: pack.summary?.totalNodes,
            totalEdges: pack.summary?.totalEdges,
            truncatedReason: pack.summary?.truncatedReason ?? pack.meta?.truncatedReason,
            caps: pack.meta?.caps
        }
    };

    const artifactPayload: FlowArtifact = {
        ...artifact,
        pack: { ...pack, raw: undefined }
    } as FlowArtifact;

    const response: any = {
        success: true,
        output: "Artifact retrieved.",
        artifact: artifactPayload,
        view
    };
    applyGraphViewBudget(response, options);
    return response;
};

export const buildEvidenceArtifactResponse = (
    artifact: FlowArtifact,
    options: { detail: "summary" | "full"; maxTokens?: number; maxChars?: number }
) => {
    const pack = (artifact as any).pack as TaskEvidencePack | undefined;
    if (!pack) {
        return {
            success: false,
            output: "Artifact not found."
        };
    }
    const rankedFiles = Array.isArray(pack.rankedFiles) ? pack.rankedFiles : [];
    const evidence = Array.isArray(pack.evidence) ? pack.evidence : [];
    const view = {
        detail: options.detail,
        rankedFiles: options.detail === "summary" ? rankedFiles.slice(0, 10) : rankedFiles,
        evidence: options.detail === "summary" ? evidence.slice(0, 3) : evidence,
        caps: pack.caps,
        degraded: pack.degraded,
        degradedReasons: pack.degradedReasons
    };
    const artifactPayload: FlowArtifact = {
        ...artifact,
        pack: {
            ...pack,
            evidence: options.detail === "summary" ? evidence.slice(0, 3) : evidence,
            rankedFiles: options.detail === "summary" ? rankedFiles.slice(0, 10) : rankedFiles
        }
    } as FlowArtifact;
    return {
        success: true,
        output: "Artifact retrieved.",
        artifact: artifactPayload,
        view
    };
};
