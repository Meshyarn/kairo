import ignore from "ignore";
import { resolvePublicSurface } from "../orchestration/policy/McpModePresetRegistry.js";
import type { ToolSpec } from "./tools/ToolSpecRegistry.js";

export const createIgnoreFilter = (patterns: string[]): any => {
    const ig = (ignore as unknown as () => any)();
    if (Array.isArray(patterns) && patterns.length > 0) {
        ig.add(patterns);
    }
    return ig;
};

export const applyIgnorePatterns = (args: {
    patterns: string[];
    symbolIndex: { updateIgnorePatterns: (patterns: string[]) => void };
    contextEngine: { updateIgnoreFilter: (filter: any) => void };
    searchEngine: { updateExcludeGlobs: (patterns: string[]) => Promise<void> | void };
    documentIndexer?: { updateIgnorePatterns: (patterns: string[]) => void };
    cacheInvalidationHub?: { onEvent: (event: { type: string }) => void };
}): void => {
    const normalized = Array.isArray(args.patterns) ? args.patterns : [];
    args.symbolIndex.updateIgnorePatterns(normalized);
    args.contextEngine.updateIgnoreFilter(createIgnoreFilter(normalized));
    void args.searchEngine.updateExcludeGlobs(normalized);
    args.documentIndexer?.updateIgnorePatterns(normalized);
    args.cacheInvalidationHub?.onEvent({ type: "ignore_changed" });
};

export const listIntentTools = (toolSpecRegistry: { listTools: (options: { exposeInternal: boolean; exposeCompat: boolean }) => ToolSpec[] }): any[] => {
    const exposeInternalTools = process.env.KAIRO_EXPOSE_INTERNAL_TOOLS === "true"
        || process.env.KAIRO_EXPOSE_LEGACY_TOOLS === "true";
    const exposeFileTools = process.env.KAIRO_EXPOSE_FILE_TOOLS === "true"
        || process.env.KAIRO_EXPOSE_COMPAT_TOOLS === "true";
    const tools = toolSpecRegistry.listTools({
        exposeInternal: exposeInternalTools,
        exposeCompat: exposeFileTools
    });
    const surface = resolvePublicSurface();
    const compactToolNames = new Set(["task", "manage"]);
    const filtered = surface === "compact" && !exposeInternalTools && !exposeFileTools
        ? tools.filter((tool) => compactToolNames.has(tool.name))
        : tools;
    return filtered.map((tool: ToolSpec) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
    }));
};

export const isPillarTool = (name: string): boolean => {
    return name === 'explore'
        || name === 'understand'
        || name === 'change'
        || name === 'write'
        || name === 'manage'
        || name === 'navigate';
};

export const validateRequiredArgs = (toolSpecRegistry: { get: (name: string) => ToolSpec | undefined }, toolName: string, args: any): string[] => {
    const toolSpec = toolSpecRegistry.get(toolName);
    const required = Array.isArray(toolSpec?.inputSchema?.required) ? toolSpec?.inputSchema?.required ?? [] : [];
    const missing: string[] = [];
    for (const key of required) {
        if (args?.[key] === undefined || args?.[key] === null) {
            missing.push(key);
        }
    }
    return missing;
};
