import type { TaskBudget } from "../../orchestration/policy/McpModePresetRegistry.js";
import { resolveAutopilotPolicy } from "../../orchestration/policy/McpModePresetRegistry.js";
import type { HandlerContext } from "../HandlerContext.js";
import type { AutoRepairAttempt, AutoRepairReport, TaskProfile } from "./TaskTypes.js";

const AUTO_REPAIR_REINDEX_PATH_LIMIT = 25;

export const resolveAutoRepairSettings = (budget: TaskBudget) => {
    const policy = resolveAutopilotPolicy();
    const maxAttempts = Number.isFinite(policy.maxAutoRepairAttempts) ? policy.maxAutoRepairAttempts : 0;
    const enabled = maxAttempts > 0 && budget === "lean";
    return {
        enabled,
        maxAttempts,
        allowAutoReindex: policy.allowAutoReindex
    };
};

export const extractFilePathFromResponse = (response: any): string | undefined => {
    const degraded = Array.isArray(response?.degradedReasons) ? response.degradedReasons : [];
    for (const entry of degraded) {
        if (entry && typeof entry.filePath === "string" && entry.filePath.length > 0) {
            return entry.filePath;
        }
    }
    if (typeof response?.targetFile === "string" && response.targetFile.length > 0) return response.targetFile;
    if (typeof response?.targetPath === "string" && response.targetPath.length > 0) return response.targetPath;
    if (typeof response?.filePath === "string" && response.filePath.length > 0) return response.filePath;
    return undefined;
};

export const attemptAutoRepair = async (
    context: HandlerContext,
    args: {
        response: any;
        sessionId?: string;
        profile: TaskProfile;
        maxTokens?: number;
        budget: TaskBudget;
        targetFiles: string[];
        paths: string[];
    }
): Promise<AutoRepairReport | undefined> => {
    const settings = resolveAutoRepairSettings(args.budget);
    if (!settings.enabled) return undefined;
    const response = args.response;
    if (!response || (response.success !== false && response.status !== "blocked")) {
        return undefined;
    }
    const blockedReason = typeof response?.blockedReason === "string" ? response.blockedReason : "";
    const errorCode = typeof response?.errorCode === "string" ? response.errorCode : "";
    const attempts: AutoRepairAttempt[] = [];

    if (blockedReason === "file_version_mismatch" || errorCode === "FILE_VERSION_MISMATCH") {
        const filePath = extractFilePathFromResponse(response)
            ?? args.targetFiles[0]
            ?? args.paths[0];
        if (!filePath) return undefined;
        const exploreArgs: Record<string, unknown> = {
            paths: [filePath],
            sessionId: args.sessionId,
            profile: args.profile,
            view: "preview",
            ...(args.maxTokens ? { limits: { maxTokens: args.maxTokens } } : {})
        };
        try {
            const exploreResponse = await context.orchestrationEngine.executePillar("explore", exploreArgs);
            const packId = exploreResponse?.pack?.packId ?? exploreResponse?.researchPack?.id;
            attempts.push({
                tool: "explore",
                args: exploreArgs,
                status: exploreResponse?.success === false ? "failure" : "success",
                summary: exploreResponse?.success === false
                    ? `Preview refresh failed for ${filePath}.`
                    : `Preview refreshed for ${filePath}.`,
                ...(packId ? { packId } : {})
            });
        } catch (error: any) {
            attempts.push({
                tool: "explore",
                args: exploreArgs,
                status: "failure",
                summary: `Preview refresh failed for ${filePath}.`,
                message: error?.message ?? "Auto-repair failed."
            });
        }
        return attempts.length > 0 ? { attempts } : undefined;
    }

    if (blockedReason === "index_stale_high" || errorCode === "INDEX_STALE_HIGH") {
        if (!settings.allowAutoReindex) return undefined;
        const indexStateManager = context.indexStateManager;
        if (!indexStateManager || typeof indexStateManager.getDirtyFiles !== "function") {
            return undefined;
        }
        const dirtyPaths = indexStateManager.getDirtyFiles(AUTO_REPAIR_REINDEX_PATH_LIMIT);
        if (dirtyPaths.length === 0) return undefined;
        const manageArgs: Record<string, unknown> = {
            command: "reindex",
            paths: dirtyPaths
        };
        const dirtyCount = typeof response?.indexSnapshot?.dirtyFileCount === "number"
            ? response.indexSnapshot.dirtyFileCount
            : dirtyPaths.length;
        try {
            const manageResponse = await context.orchestrationEngine.executePillar("manage", manageArgs);
            const truncated = dirtyCount > dirtyPaths.length;
            const summary = manageResponse?.success === false
                ? "Reindex auto-repair failed."
                : (truncated
                    ? `Reindex enqueued for ${dirtyPaths.length} of ${dirtyCount} dirty paths.`
                    : `Reindex enqueued for ${dirtyPaths.length} path(s).`);
            attempts.push({
                tool: "manage",
                args: manageArgs,
                status: manageResponse?.success === false ? "failure" : "success",
                summary
            });
        } catch (error: any) {
            attempts.push({
                tool: "manage",
                args: manageArgs,
                status: "failure",
                summary: "Reindex auto-repair failed.",
                message: error?.message ?? "Auto-repair failed."
            });
        }
        return attempts.length > 0 ? { attempts } : undefined;
    }

    return undefined;
};
