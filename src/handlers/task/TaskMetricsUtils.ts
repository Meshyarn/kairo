import { metrics } from "../../utils/MetricsCollector.js";
import type { TaskBudget } from "../../orchestration/policy/McpModePresetRegistry.js";
import type { TraceBuilder } from "../../orchestration/trace/TraceBuilder.js";
import type { TaskEvidencePack } from "../../types/flow-artifacts.js";
import type { HandlerContext } from "../HandlerContext.js";
import type { TaskMode } from "./TaskTypes.js";

export const recordTaskMetrics = (args: {
    mode: TaskMode;
    budget: TaskBudget;
    stepCount: number;
    traceBuilder?: TraceBuilder;
    lod?: {
        defaultLod: number;
        resolvedLod: number;
        evidencePack?: TaskEvidencePack;
    };
}): void => {
    metrics.inc("task.request_total", 1, "basic");
    metrics.inc(`task.mode.${args.mode}.total`, 1, "basic");
    metrics.inc(`task.budget.${args.budget}.total`, 1, "basic");
    metrics.observe("task.steps.count", args.stepCount, "basic");
    metrics.observe(`task.steps.count.${args.mode}`, args.stepCount, "basic");
    if (args.lod) {
        metrics.gauge("task.lod.resolved", args.lod.resolvedLod, "basic");
        metrics.gauge(`task.lod.resolved.${args.mode}`, args.lod.resolvedLod, "basic");
        metrics.gauge(`task.lod.default.${args.mode}`, args.lod.defaultLod, "basic");
        if (args.lod.resolvedLod < args.lod.defaultLod) {
            metrics.inc("task.lod.downshift_total", 1, "basic");
            metrics.inc(`task.lod.downshift.${args.lod.defaultLod}_to_${args.lod.resolvedLod}`, 1, "basic");
        }
        const evidenceItems = args.lod.evidencePack?.evidence?.length ?? 0;
        const evidenceFiles = args.lod.evidencePack?.rankedFiles?.length ?? 0;
        metrics.observe("task.evidence.items", evidenceItems, "basic");
        metrics.observe("task.evidence.files", evidenceFiles, "basic");
    }
    args.traceBuilder?.recordEvent({
        area: "policy",
        code: "task.metrics",
        data: {
            mode: args.mode,
            budget: args.budget,
            stepCount: args.stepCount,
            ...(args.lod
                ? {
                    defaultLod: args.lod.defaultLod,
                    resolvedLod: args.lod.resolvedLod,
                    evidenceItems: args.lod.evidencePack?.evidence?.length ?? 0,
                    evidenceFiles: args.lod.evidencePack?.rankedFiles?.length ?? 0
                }
                : {})
        }
    });
};

const DEFAULT_TASK_EVIDENCE_TTL_MS = Number.parseInt(process.env.KAIRO_TASK_EVIDENCE_TTL_MS ?? "1800000", 10) || 1800000;

export const storeEvidencePack = (
    context: HandlerContext,
    args: { pack: TaskEvidencePack; sessionId?: string; intent?: string }
): string | undefined => {
    const manager = context.flowArtifactManager;
    if (!manager) return undefined;
    const createdAt = typeof args.pack.createdAt === "number" ? args.pack.createdAt : Date.now();
    const expiresAt = typeof args.pack.expiresAt === "number"
        ? args.pack.expiresAt
        : createdAt + DEFAULT_TASK_EVIDENCE_TTL_MS;
    args.pack.createdAt = createdAt;
    args.pack.expiresAt = expiresAt;
    return manager.store({
        id: args.pack.id,
        type: "evidence",
        createdAt,
        expiresAt,
        pack: args.pack,
        sessionId: args.sessionId,
        metadata: args.intent ? { intent: args.intent } : undefined
    });
};
