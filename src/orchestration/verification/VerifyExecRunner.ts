import path from "path";
import { spawn } from "child_process";
import type { VerifyExecCommand } from "./VerifyExecConfig.js";

export type VerifyExecResult = {
    id: string;
    ok: boolean;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    durationMs: number;
    stdout: string;
    stderr: string;
    truncated: boolean;
};

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 300_000;

const resolveCwd = (rootPath: string, cwd?: string): string => {
    if (!cwd) return rootPath;
    const root = path.resolve(rootPath);
    const resolved = path.resolve(root, cwd);
    const relative = path.relative(root, resolved);
    const isInside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    return isInside ? resolved : root;
};

export const runVerifyExec = async (args: {
    commands: VerifyExecCommand[];
    rootPath: string;
    maxOutputBytes?: number;
}): Promise<VerifyExecResult[]> => {
    const maxBytes = Math.max(1024, args.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
    const results: VerifyExecResult[] = [];
    for (const command of args.commands) {
        const startedAt = Date.now();
        const cwd = resolveCwd(args.rootPath, command.cwd);
        const env = command.env ? { ...process.env, ...command.env } : process.env;
        const timeoutMs = Number.isFinite(command.timeoutMs) ? Number(command.timeoutMs) : DEFAULT_TIMEOUT_MS;
        const result = await new Promise<VerifyExecResult>((resolve) => {
            let stdout = "";
            let stderr = "";
            let truncated = false;
            const child = spawn(command.cmd, command.args ?? [], {
                cwd,
                env,
                shell: false
            });
            const append = (chunk: Buffer, target: "stdout" | "stderr") => {
                if (truncated) return;
                const text = chunk.toString("utf-8");
                const used = stdout.length + stderr.length;
                const remaining = maxBytes - used;
                if (remaining <= 0) {
                    truncated = true;
                    return;
                }
                if (text.length > remaining) {
                    truncated = true;
                    if (target === "stdout") {
                        stdout += text.slice(0, remaining);
                    } else {
                        stderr += text.slice(0, remaining);
                    }
                    return;
                }
                if (target === "stdout") {
                    stdout += text;
                } else {
                    stderr += text;
                }
            };
            child.stdout?.on("data", (chunk: Buffer) => append(chunk, "stdout"));
            child.stderr?.on("data", (chunk: Buffer) => append(chunk, "stderr"));
            const timer = setTimeout(() => {
                child.kill("SIGKILL");
            }, timeoutMs);
            child.on("error", () => {
                clearTimeout(timer);
                resolve({
                    id: command.id,
                    ok: false,
                    exitCode: null,
                    signal: null,
                    durationMs: Date.now() - startedAt,
                    stdout,
                    stderr,
                    truncated
                });
            });
            child.on("close", (code, signal) => {
                clearTimeout(timer);
                resolve({
                    id: command.id,
                    ok: code === 0,
                    exitCode: code,
                    signal,
                    durationMs: Date.now() - startedAt,
                    stdout,
                    stderr,
                    truncated
                });
            });
        });
        results.push(result);
    }
    return results;
};
