import type { ExploreResponse } from "../../orchestration/pillars/explore/ResultFormatter.js";
import type { TaskBudget, TaskBudgetPolicy } from "../../orchestration/policy/McpModePresetRegistry.js";
import type { DegradedReason } from "../../types/tool-responses.js";

export const mergeDegradedReasons = (...sources: Array<DegradedReason[] | undefined>): DegradedReason[] | undefined => {
    const combined = sources.flatMap((items) => items ?? []);
    if (combined.length === 0) return undefined;
    const seen = new Set<string>();
    const unique: DegradedReason[] = [];
    for (const entry of combined) {
        const key = `${entry.type}|${entry.filePath ?? ""}|${entry.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(entry);
    }
    return unique.length > 0 ? unique : undefined;
};

export const buildExploreDecisionGate = (args: {
    response: ExploreResponse;
    budgetPolicy: TaskBudgetPolicy;
    request: string;
    budget: TaskBudget;
    sessionId?: string;
    targetFiles: string[];
}): { insufficient: boolean; reasons?: string[]; nextCalls?: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> } => {
    const codeItems = Array.isArray(args.response?.data?.code) ? args.response.data.code : [];
    const docItems = Array.isArray(args.response?.data?.docs) ? args.response.data.docs : [];
    const targets = new Set<string>();
    for (const item of [...codeItems, ...docItems]) {
        if (typeof item?.filePath === "string") {
            targets.add(item.filePath);
        }
    }
    const evidenceCount = codeItems.length + docItems.length;
    const hasExplicitTarget = args.targetFiles.length > 0;
    const enoughTargets = hasExplicitTarget || targets.size >= args.budgetPolicy.minTargets;
    const enoughEvidence = evidenceCount >= args.budgetPolicy.minEvidence;
    const insufficient = !(enoughTargets && enoughEvidence);
    if (!insufficient) return { insufficient };

    const reasons = ["insufficient_evidence"];
    const topTarget = args.targetFiles[0]
        ?? codeItems[0]?.filePath
        ?? docItems[0]?.filePath;
    const nextCalls: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> = [];
    if (topTarget) {
        nextCalls.push({
            tool: "task",
            args: {
                request: args.request,
                mode: "analyze",
                budget: args.budget,
                targetFiles: [topTarget],
                sessionId: args.sessionId
            },
            reason: "Need deeper analysis of the top candidate file."
        });
    }
    return { insufficient, reasons, nextCalls };
};

export const buildAnalyzeDecisionGate = (args: {
    response: any;
    budgetPolicy: TaskBudgetPolicy;
    request: string;
    budget: TaskBudget;
    sessionId?: string;
    targetFiles: string[];
    paths: string[];
}): { insufficient: boolean; reasons?: string[]; nextCalls?: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> } => {
    const primaryFile = typeof args.response?.primaryFile === "string" ? args.response.primaryFile : "";
    const hasPrimary = primaryFile.length > 0 && primaryFile !== "unknown";
    if (hasPrimary) return { insufficient: false };

    const reasons = ["insufficient_evidence"];
    const nextCalls: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> = [];
    if (args.targetFiles.length > 0 || args.paths.length > 0) {
        nextCalls.push({
            tool: "task",
            args: {
                request: args.request,
                mode: "ask",
                budget: args.budget,
                targetFiles: args.targetFiles.length > 0 ? args.targetFiles : undefined,
                paths: args.paths.length > 0 ? args.paths : undefined,
                sessionId: args.sessionId
            },
            reason: "Need more discovery signals before analysis."
        });
    }
    return { insufficient: true, reasons, nextCalls };
};
