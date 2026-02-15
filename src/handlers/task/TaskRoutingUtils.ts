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
    if (raw === "fast") {
        return "lean";
    }
    return "balanced";
};

export const normalizeProfile = (raw: any): TaskProfile => {
    if (raw === "lean" || raw === "fast" || raw === "balanced" || raw === "deep") {
        return raw;
    }
    return "balanced";
};

export const normalizeDepthAlias = (raw: any): TaskProfile | undefined => {
    if (raw === "shallow") return "lean";
    if (raw === "standard") return "balanced";
    if (raw === "deep") return "deep";
    return undefined;
};

export const resolveBudgetFromProfile = (profile: TaskProfile): TaskBudget => {
    if (profile === "deep") return "deep";
    if (profile === "fast" || profile === "lean") return "lean";
    return "balanced";
};

export const resolveProfile = (budget: TaskBudget): TaskProfile => {
    if (budget === "balanced") return "balanced";
    if (budget === "deep") return "deep";
    return "lean";
};

export const normalizeSafety = (raw: any): "plan" | "apply" | "auto" | undefined => {
    if (raw === "plan" || raw === "apply" || raw === "auto") {
        return raw;
    }
    return undefined;
};

export const extractPillarOptions = (value: any): Record<string, unknown> | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    return value as Record<string, unknown>;
};

const isPlainObject = (value: any): value is Record<string, unknown> => {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

export const pickPillarOptions = (
    pillar: "explore" | "understand" | "change" | "write" | "verify",
    options?: Record<string, unknown>
): Record<string, unknown> | undefined => {
    if (!options) return undefined;
    const topLevel: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options)) {
        if (["common", "explore", "understand", "change", "write", "verify"].includes(key)) {
            continue;
        }
        topLevel[key] = value;
    }
    const common = isPlainObject(options.common) ? options.common : undefined;
    const scoped = isPlainObject(options[pillar]) ? (options[pillar] as Record<string, unknown>) : undefined;
    const merged = {
        ...(common ?? {}),
        ...topLevel,
        ...(scoped ?? {})
    };
    return Object.keys(merged).length > 0 ? merged : undefined;
};

export const mergePillarArgs = (
    base: Record<string, unknown>,
    options: Record<string, unknown> | undefined,
    lockedKeys: string[]
): Record<string, unknown> => {
    if (!options) return base;
    const merged = {
        ...base,
        ...options
    };
    for (const key of lockedKeys) {
        if (base[key] !== undefined) {
            merged[key] = base[key];
        }
    }
    return merged;
};

const countLines = (value?: string): number => {
    if (typeof value !== "string" || value.length === 0) return 0;
    return value.split(/\r?\n/).length;
};

const extractInlineText = (value: any): string | undefined => {
    if (typeof value === "string") return value;
    if (!isPlainObject(value)) return undefined;
    if (typeof value.text === "string") return value.text;
    if (value.kind === "utf8" && typeof value.value === "string") return value.value;
    return undefined;
};

export const isSmallAutoApplyCandidate = (args: {
    targetFiles: string[];
    edits: any[];
    maxLines: number;
}): boolean => {
    if (!Array.isArray(args.edits) || args.edits.length !== 1) return false;
    const edit = args.edits[0] ?? {};
    const uniqueTargets = Array.from(new Set([
        ...args.targetFiles.filter((item) => typeof item === "string" && item.length > 0),
        typeof edit?.filePath === "string" ? edit.filePath : undefined
    ].filter(Boolean) as string[]));
    if (uniqueTargets.length !== 1) return false;

    const targetString = extractInlineText(edit?.targetString ?? edit?.targetSource);
    const replacementString = extractInlineText(edit?.replacementString ?? edit?.replacementSource);
    const candidateLines = Math.max(countLines(targetString), countLines(replacementString));
    if (candidateLines <= 0) return false;
    return candidateLines <= Math.max(1, args.maxLines);
};

export const isTaskAutoApplyEnabled = (): boolean => {
    return (process.env.KAIRO_ENABLE_AUTO_APPLY ?? "").toLowerCase() === "true";
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
