import type { OrchestrationContext } from "../../OrchestrationContext.js";
import type { InternalToolRegistry } from "../../InternalToolRegistry.js";
import type { ExploreItem, ExploreResponse } from "./ResultFormatter.js";
import { AstManager } from "../../../ast/AstManager.js";
import { buildDegradedReasons } from "../../DegradedReasonMapper.js";
import { estimateTokens } from "../../TokenBudget.js";
import { resolveRepoInfo } from "../../../utils/RepoScope.js";
import { expandPaths, buildItemForPath } from "./PathExpansion.js";
import { applySoftPriority, isBinaryPath, isDocPath, isSensitivePath } from "./FilteringStrategy.js";
import type { ExploreExecutionSetup } from "./ExplorePillarExecutionSetup.js";
import type { ExploreExecutionState } from "./ExplorePillarExecutionState.js";

export async function executeExplorePaths(args: {
    setup: ExploreExecutionSetup;
    state: ExploreExecutionState;
    response: ExploreResponse;
    registry: InternalToolRegistry;
    context: OrchestrationContext;
    runTool: (context: OrchestrationContext, tool: string, args: any) => Promise<any>;
    applyBudgetToItem: (item: ExploreItem, isFullContent: boolean, allowDistill: boolean) => ExploreItem;
}): Promise<ExploreResponse | undefined> {
    const { setup, state, response, registry, context, runTool, applyBudgetToItem } = args;
    const { input } = setup;
    if (input.paths.length === 0) return undefined;

    const expanded = await expandPaths(input.paths, { allowGlobs: input.allowGlobs, maxFiles: setup.maxFiles, includeDocs: setup.includeDocs, includeCode: setup.includeCode }, registry);

    if (expanded.blocked) {
        return {
            success: false,
            status: "invalid_args",
            message: expanded.message ?? "Invalid paths.",
            data: { docs: [], code: [] },
            sessionId: input.resolvedSessionId
        };
    }

    const selected = applySoftPriority(expanded.entries, setup.maxFiles, setup.includeDocs, setup.includeCode);
    const fullPathSet = new Set(input.fullPaths);

    for (const entry of selected) {
        if (!setup.includeDocs && isDocPath(entry.path)) continue;
        if (!setup.includeCode && !isDocPath(entry.path)) continue;

        const wantsFull = setup.view === "full" && (input.fullPaths.length === 0 || fullPathSet.has(entry.path));
        if (wantsFull) {
            if (!input.allowSensitive && isSensitivePath(entry.path)) {
                return {
                    success: false,
                    status: "blocked",
                    message: `Full read blocked for sensitive path: ${entry.path}`,
                    data: { docs: [], code: [] },
                    sessionId: input.resolvedSessionId
                };
            }
            if (!input.allowBinary && isBinaryPath(entry.path)) {
                return {
                    success: false,
                    status: "blocked",
                    message: `Full read blocked for binary path: ${entry.path}`,
                    data: { docs: [], code: [] },
                    sessionId: input.resolvedSessionId
                };
            }
            if (typeof setup.maxBytes === "number" && entry.size && entry.size > setup.maxBytes) {
                return {
                    success: false,
                    status: "blocked",
                    message: `Full read blocked by maxBytes for ${entry.path}.`,
                    data: { docs: [], code: [] },
                    sessionId: input.resolvedSessionId
                };
            }
        }

        const item = await buildItemForPath(
            entry.path,
            { view: setup.view, maxChars: setup.maxChars, maxItemChars: setup.maxItemChars, allowSensitive: input.allowSensitive, allowBinary: input.allowBinary, wantsFull, section: input.constraints.section },
            context,
            (ctx, tool, args) => runTool(ctx, tool, args),
            registry.getMetadata("fileSystem")
        );

        if (item.blocked) {
            let reason = item.reason;
            if (!reason && typeof item.message === "string" && item.message.includes("Syntax validation failed")) {
                reason = "syntax_validation_failed";
            }
            const reasons = reason ? [reason] : undefined;
            const languageId = reason ? AstManager.getInstance().getLanguageId(entry.path) : undefined;
            const degradedReasons = reasons
                ? buildDegradedReasons(reasons, { languageId, filePath: entry.path })
                : undefined;
            return {
                success: false,
                status: "blocked",
                message: item.message ?? "Full read blocked.",
                data: { docs: [], code: [] },
                reasons,
                degradedReasons,
                sessionId: input.resolvedSessionId
            };
        }

        if (item.degraded) {
            state.degraded = true;
            if (item.reason) state.reasons.push(item.reason);
        }

        const payloadItem = item.value;
        if (!payloadItem) continue;

        const isFullContent = typeof payloadItem.content === "string";
        applyBudgetToItem(payloadItem, isFullContent, setup.view !== "full");

        if (setup.repoRegistry && setup.pathNormalizer) {
            try {
                const repoInfo = resolveRepoInfo(payloadItem.filePath, setup.repoRegistry, setup.pathNormalizer);
                payloadItem.metadata = {
                    ...(payloadItem.metadata ?? {}),
                    repoId: repoInfo.repoId,
                    ...(repoInfo.repoRelativePath ? { repoRelativePath: repoInfo.repoRelativePath } : {})
                };
            } catch {
                // ignore repo scope metadata failures
            }
        }

        const contentText = payloadItem.content ?? payloadItem.preview ?? "";
        const contentLength = contentText.length;
        const itemTokens = estimateTokens(contentText, {
            languageId: isDocPath(payloadItem.filePath) ? undefined : AstManager.getInstance().getLanguageId(payloadItem.filePath)
        });
        if (setup.maxTokens) {
            if (setup.view === "full") {
                if (state.totalTokens + itemTokens > setup.maxTokens) {
                    return {
                        success: false,
                        status: "blocked",
                        message: "Full read blocked by maxTokens. Increase limits.maxTokens and retry.",
                        data: { docs: [], code: [] },
                        sessionId: input.resolvedSessionId
                    };
                }
            } else if (state.totalTokens + itemTokens > setup.maxTokens) {
                state.degraded = true;
                state.reasons.push("budget_exceeded");
                break;
            }
        }
        if (setup.view === "full") {
            if (state.totalChars + contentLength > setup.maxChars) {
                return {
                    success: false,
                    status: "blocked",
                    message: "Full read blocked by maxChars. Increase limits.maxChars and retry.",
                    data: { docs: [], code: [] },
                    sessionId: input.resolvedSessionId
                };
            }
        } else {
            if (state.totalChars + contentLength > setup.maxChars) {
                state.degraded = true;
                state.reasons.push("budget_exceeded");
                break;
            }
        }
        state.totalChars += contentLength;
        state.totalTokens += itemTokens;

        if (isDocPath(entry.path)) {
            response.data.docs.push(payloadItem);
        } else {
            response.data.code.push(payloadItem);
        }
    }

    return undefined;
}
