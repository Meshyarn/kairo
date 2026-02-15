import { IntentRouter } from "../../orchestration/IntentRouter.js";
import type { TaskBudget } from "../../orchestration/policy/McpModePresetRegistry.js";
import type { TaskMode, TaskProfile } from "./TaskTypes.js";

export const normalizeMode = (raw: any): TaskMode => {
    if (raw === "ask" || raw === "analyze" || raw === "auto" || raw === "plan_change" || raw === "apply_change" || raw === "write" || raw === "verify") {
        return raw;
    }
    return "auto";
};

export const normalizeBudget = (raw: any): TaskBudget => {
    if (raw === "balanced" || raw === "deep" || raw === "lean") {
        return raw;
    }
    return "balanced";
};

export const resolveProfile = (budget: TaskBudget): TaskProfile => {
    if (budget === "balanced") return "balanced";
    if (budget === "deep") return "deep";
    return "lean";
};

export const normalizeSafety = (raw: any): "plan" | "apply" | undefined => {
    if (raw === "plan" || raw === "apply") {
        return raw;
    }
    return undefined;
};

export const resolveRoutingMode = (intentRouter: IntentRouter, mode: TaskMode, request: string) => {
    if (mode !== "auto") {
        return { mode, category: undefined as string | undefined };
    }
    const parsed = intentRouter.parse(request);
    const category = parsed.category;
    if (category === "understand") return { mode: "analyze" as TaskMode, category };
    if (category === "explore" || category === "navigate" || category === "read") {
        return { mode: "ask" as TaskMode, category };
    }
    if (category === "change") return { mode: "plan_change" as TaskMode, category };
    if (category === "write") return { mode: "write" as TaskMode, category };
    return { mode: "ask" as TaskMode, category };
};

export const resolveTargetPath = (targetFiles: string[], paths: string[], targetPath?: string): string | undefined => {
    if (targetFiles.length > 0) return targetFiles[0];
    if (targetPath) return targetPath;
    if (paths.length > 0) return paths[0];
    return undefined;
};

export const extractContentFromRequest = (request: string): string | undefined => {
    if (!request) return undefined;
    const match = request.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
    if (!match) return undefined;
    return match[1].trimEnd();
};

export const extractPaths = (value: any): string[] => {
    if (!Array.isArray(value)) return [];
    return value.filter((item) => typeof item === "string" && item.length > 0);
};

export const extractEdits = (value: any): any[] => {
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item !== null && item !== undefined);
};

export const extractMaxTokens = (value: any): number | undefined => {
    const raw = value?.maxTokens;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return parsed;
};

export const extractMaxChars = (value: any): number | undefined => {
    const raw = value?.maxChars;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return parsed;
};
