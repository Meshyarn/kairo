import path from "path";
import { spawnSync } from "child_process";
import type { IFileSystem } from "../../platform/FileSystem.js";

export type FormatterMode = "auto" | "off" | "prettier";

export type FormatterResult = {
    applied: boolean;
    skippedReason?:
        | "formatter_off"
        | "formatter_skipped_budget"
        | "formatter_skipped_untracked"
        | "formatter_unavailable"
        | "formatter_no_config"
        | "formatter_failed";
    errorMessage?: string;
    degradedReasons?: string[];
    suggestedActions?: Array<{
        id: string;
        description: string;
        rationale: string;
        toolCall: { tool: string; args: Record<string, unknown> };
    }>;
};

const DEFAULT_MAX_FILES = Number.parseInt(process.env.KAIRO_FORMATTER_MAX_FILES ?? "10", 10) || 10;

const FORMATTER_CONFIGS = [
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.js",
    ".prettierrc.cjs",
    ".prettierrc.yml",
    ".prettierrc.yaml",
    "prettier.config.js",
    "prettier.config.cjs",
    "prettier.config.mjs",
    ".eslintrc",
    ".eslintrc.json",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.yml",
    ".eslintrc.yaml",
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
    "biome.json",
    "biome.jsonc",
    "rustfmt.toml"
];

export async function applyFormatterBridge(args: {
    mode?: FormatterMode | string;
    filePaths: string[];
    rootPath: string;
    fileSystem: IFileSystem;
    tool?: string;
    rollbackAvailable?: boolean;
}): Promise<FormatterResult | undefined> {
    const mode = normalizeMode(args.mode);
    const tool = args.tool ?? "change";
    if (!mode || mode === "off") {
        return { applied: false, skippedReason: "formatter_off" };
    }
    if (args.filePaths.length === 0) {
        return { applied: false, skippedReason: "formatter_off" };
    }
    if (args.filePaths.length > DEFAULT_MAX_FILES) {
        return {
            applied: false,
            skippedReason: "formatter_skipped_budget",
            degradedReasons: ["formatter_skipped_budget"],
            suggestedActions: [
                {
                    id: "formatter.retry_subset",
                    description: "Retry formatter with fewer files.",
                    rationale: "Formatter run skipped due to file count budget.",
                    toolCall: { tool, args: { options: { formatter: mode } } }
                }
            ]
        };
    }

    const allowUntracked = (process.env.KAIRO_FORMATTER_ALLOW_UNTRACKED ?? "false").toLowerCase() === "true";
    if (args.rollbackAvailable && !allowUntracked) {
        return {
            applied: false,
            skippedReason: "formatter_skipped_untracked",
            degradedReasons: ["formatter_skipped_untracked"],
            suggestedActions: [
                {
                    id: "formatter.off",
                    description: "Retry without formatter.",
                    rationale: "Formatter was skipped to preserve undo/rollback integrity. Set KAIRO_FORMATTER_ALLOW_UNTRACKED=true to allow untracked formatter writes.",
                    toolCall: { tool, args: { options: { formatter: "off" } } }
                }
            ]
        };
    }

    const hasConfig = await detectFormatterConfig(args.fileSystem);
    if (!hasConfig && mode === "auto") {
        return { applied: false, skippedReason: "formatter_no_config" };
    }

    const prettierPath = resolvePrettierBinary(args.rootPath);
    if (!prettierPath || !(await args.fileSystem.exists(prettierPath))) {
        return {
            applied: false,
            skippedReason: "formatter_unavailable",
            degradedReasons: ["formatter_unavailable"],
            suggestedActions: [
                {
                    id: "formatter.off",
                    description: "Retry without formatter.",
                    rationale: "Formatter binary not found in the project. Install it or run `npx prettier --write <paths>`.",
                    toolCall: { tool, args: { options: { formatter: "off" } } }
                }
            ]
        };
    }

    const result = spawnSync(prettierPath, ["--write", ...args.filePaths], {
        cwd: args.rootPath,
        encoding: "utf-8",
        shell: false
    });
    if (result.error) {
        return {
            applied: false,
            skippedReason: "formatter_unavailable",
            degradedReasons: ["formatter_unavailable"],
            errorMessage: result.error.message,
            suggestedActions: [
                {
                    id: "formatter.off",
                    description: "Retry without formatter.",
                    rationale: "Formatter execution failed to launch.",
                    toolCall: { tool, args: { options: { formatter: "off" } } }
                }
            ]
        };
    }
    if (result.status !== 0) {
        return {
            applied: false,
            skippedReason: "formatter_failed",
            degradedReasons: ["formatter_failed"],
            errorMessage: result.stderr || result.stdout,
            suggestedActions: [
                {
                    id: "formatter.retry",
                    description: "Retry formatting on a smaller subset.",
                    rationale: "Formatter failed; narrowing scope may help isolate the issue.",
                    toolCall: { tool, args: { options: { formatter: mode } } }
                }
            ]
        };
    }

    return { applied: true };
}

async function detectFormatterConfig(fileSystem: IFileSystem): Promise<boolean> {
    for (const config of FORMATTER_CONFIGS) {
        if (await fileSystem.exists(config)) {
            return true;
        }
    }
    return false;
}

function normalizeMode(mode?: string): FormatterMode | undefined {
    if (!mode) return undefined;
    const normalized = mode.trim().toLowerCase();
    if (normalized === "off") return "off";
    if (normalized === "auto") return "auto";
    if (normalized === "prettier") return "prettier";
    return "auto";
}

function resolvePrettierBinary(rootPath: string): string | undefined {
    const localBin = path.join(rootPath, "node_modules", ".bin", process.platform === "win32" ? "prettier.cmd" : "prettier");
    return localBin;
}
