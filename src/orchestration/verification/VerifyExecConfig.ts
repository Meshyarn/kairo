import fs from "fs";
import path from "path";
import { PathManager } from "../../utils/PathManager.js";

export type VerifyExecCommand = {
    id: string;
    cmd: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
};

export type VerifyExecConfig = {
    version: number;
    enabled: boolean;
    allowedCommands: VerifyExecCommand[];
};

const DEFAULT_CONFIG: VerifyExecConfig = {
    version: 1,
    enabled: false,
    allowedCommands: []
};

const normalizeCommand = (raw: any): VerifyExecCommand | null => {
    if (!raw || typeof raw !== "object") return null;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const cmd = typeof raw.cmd === "string" ? raw.cmd.trim() : "";
    if (!id || !cmd) return null;
    const args = Array.isArray(raw.args) ? raw.args.filter((item: any) => typeof item === "string") : undefined;
    const cwd = typeof raw.cwd === "string" && raw.cwd.trim().length > 0 ? raw.cwd.trim() : undefined;
    const env = raw.env && typeof raw.env === "object" ? raw.env : undefined;
    const timeoutMs = Number.isFinite(raw.timeoutMs) ? Number(raw.timeoutMs) : undefined;
    return {
        id,
        cmd,
        ...(args ? { args } : {}),
        ...(cwd ? { cwd } : {}),
        ...(env ? { env } : {}),
        ...(timeoutMs ? { timeoutMs } : {})
    };
};

export const loadVerifyExecConfig = (rootPath: string): { config: VerifyExecConfig; path: string; error?: string } => {
    const configPath = PathManager.resolveForRoot(rootPath, "config", "verify-exec.json");
    if (!fs.existsSync(configPath)) {
        return { config: DEFAULT_CONFIG, path: configPath };
    }
    try {
        const raw = fs.readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        const enabled = parsed?.enabled === true;
        const allowedCommands = Array.isArray(parsed?.allowedCommands)
            ? parsed.allowedCommands.map(normalizeCommand).filter(Boolean) as VerifyExecCommand[]
            : [];
        return {
            config: {
                version: typeof parsed?.version === "number" ? parsed.version : DEFAULT_CONFIG.version,
                enabled,
                allowedCommands
            },
            path: configPath
        };
    } catch (error: any) {
        return {
            config: DEFAULT_CONFIG,
            path: configPath,
            error: error?.message ?? "Failed to parse verify-exec config."
        };
    }
};
