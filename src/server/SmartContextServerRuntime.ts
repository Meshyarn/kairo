import * as fs from "fs";
import * as path from "path";
import util from "util";
import { PathManager } from "../utils/PathManager.js";
import { StorageMaintenanceService, type StoragePruneTarget } from "../indexing/StorageMaintenanceService.js";
import type { IndexDatabase } from "../indexing/IndexDatabase.js";
import type { DocumentSearchEngine } from "../documents/search/DocumentSearchEngine.js";

export type SmartContextRuntimeHost = {
    logStream?: fs.WriteStream;
    logStreams?: {
        console: fs.WriteStream;
        warn: fs.WriteStream;
        error: fs.WriteStream;
        stdout: fs.WriteStream;
        stderr: fs.WriteStream;
    };
    diagnosticsInitialized: boolean;
    heartbeatTimer?: NodeJS.Timeout;
    shutdownRequested: boolean;
    shutdownTimer?: NodeJS.Timeout;
    storagePruneTimer?: NodeJS.Timeout;
    storagePruneRunning: boolean;
    rootPath: string;
    indexDatabase: IndexDatabase;
    documentSearchEngine: DocumentSearchEngine;
    isTestEnv: () => boolean;
    shutdown: () => Promise<void>;
};

export const initFileLogger = (host: SmartContextRuntimeHost): void => {
    if (host.logStream) return;
    const enabled = (process.env.KAIRO_LOG_TO_FILE === "true") || !!process.env.KAIRO_LOG_FILE;
    if (!enabled) return;
    const singleFilePath = process.env.KAIRO_LOG_FILE;
    const logDir = process.env.KAIRO_LOG_DIR || PathManager.resolve("logs");
    try {
        if (singleFilePath) {
            fs.mkdirSync(path.dirname(singleFilePath), { recursive: true });
            host.logStream = fs.createWriteStream(singleFilePath, { flags: "a" });
        } else {
            fs.mkdirSync(logDir, { recursive: true });
            host.logStreams = {
                console: fs.createWriteStream(path.join(logDir, "console.log"), { flags: "a" }),
                warn: fs.createWriteStream(path.join(logDir, "console.warn.log"), { flags: "a" }),
                error: fs.createWriteStream(path.join(logDir, "console.error.log"), { flags: "a" }),
                stdout: fs.createWriteStream(path.join(logDir, "stdout.log"), { flags: "a" }),
                stderr: fs.createWriteStream(path.join(logDir, "stderr.log"), { flags: "a" })
            };
        }
    } catch (error) {
        console.warn("[SmartContextServer] Failed to initialize file logger:", error);
        return;
    }

    const writeLine = (level: string, args: unknown[], stream?: fs.WriteStream) => {
        const target = stream ?? host.logStream;
        if (!target) return;
        const timestamp = new Date().toISOString();
        const message = util.format(...args);
        target.write(`[${timestamp}] [${level}] ${message}\n`);
    };

    const wrap = (level: string, original: (...args: unknown[]) => void, stream?: fs.WriteStream) => {
        return (...args: unknown[]) => {
            original(...args);
            writeLine(level, args, stream);
        };
    };

    console.log = wrap("log", console.log.bind(console), host.logStreams?.console);
    console.info = wrap("info", console.info.bind(console), host.logStreams?.console);
    console.debug = wrap("debug", console.debug.bind(console), host.logStreams?.console);
    console.warn = wrap("warn", console.warn.bind(console), host.logStreams?.warn);
    console.error = wrap("error", console.error.bind(console), host.logStreams?.error);

    const stdoutWrite = process.stdout.write.bind(process.stdout);
    const stderrWrite = process.stderr.write.bind(process.stderr);
    const teeStream = (level: string, original: typeof stdoutWrite, stream?: fs.WriteStream) => {
        return (chunk: any, encoding?: any, cb?: any) => {
            try {
                const target = stream ?? host.logStream;
                if (target) {
                    const timestamp = new Date().toISOString();
                    const text = typeof chunk === "string" ? chunk : chunk?.toString?.(encoding) ?? "";
                    if (text.length > 0) {
                        const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
                        for (const line of lines) {
                            if (line.length === 0) continue;
                            target.write(`[${timestamp}] [${level}] ${line}\n`);
                        }
                    }
                }
            } catch {
                // ignore
            }
            return original(chunk, encoding as any, cb as any);
        };
    };

    process.stdout.write = teeStream("stdout", stdoutWrite, host.logStreams?.stdout) as typeof process.stdout.write;
    process.stderr.write = teeStream("stderr", stderrWrite, host.logStreams?.stderr) as typeof process.stderr.write;

    process.on("exit", () => {
        try {
            host.logStream?.end();
            if (host.logStreams) {
                host.logStreams.console.end();
                host.logStreams.warn.end();
                host.logStreams.error.end();
                host.logStreams.stdout.end();
                host.logStreams.stderr.end();
            }
        } catch {
            // ignore
        }
    });
};

export const initProcessDiagnostics = (host: SmartContextRuntimeHost): void => {
    if (host.diagnosticsInitialized) return;
    if (host.isTestEnv()) {
        host.diagnosticsInitialized = true;
        return;
    }
    host.diagnosticsInitialized = true;

    const logMemory = (label: string) => {
        try {
            const mem = process.memoryUsage();
            const mb = (value: number) => Math.round((value / (1024 * 1024)) * 100) / 100;
            console.warn(`[Process] ${label} rss=${mb(mem.rss)}MB heapUsed=${mb(mem.heapUsed)}MB heapTotal=${mb(mem.heapTotal)}MB ext=${mb(mem.external)}MB`);
        } catch {
            // ignore
        }
    };

    process.on("uncaughtException", (err) => {
        console.error("[Process] uncaughtException", err);
        logMemory("uncaughtException");
        if (!host.isTestEnv()) {
            process.exit(1);
        }
    });
    process.on("unhandledRejection", (reason) => {
        console.error("[Process] unhandledRejection", reason);
        logMemory("unhandledRejection");
        if (!host.isTestEnv()) {
            process.exit(1);
        }
    });
    process.on("warning", (warning) => {
        console.warn("[Process] warning", warning);
    });
    process.on("exit", (code) => {
        console.warn(`[Process] exit code=${code}`);
        logMemory("exit");
    });
    process.on("SIGTERM", () => {
        console.warn("[Process] SIGTERM received");
        logMemory("SIGTERM");
    });
    process.on("SIGINT", () => {
        console.warn("[Process] SIGINT received");
        logMemory("SIGINT");
    });
    process.on("SIGHUP", () => {
        console.warn("[Process] SIGHUP received");
        logMemory("SIGHUP");
    });
};

export const startHeartbeat = (host: SmartContextRuntimeHost): void => {
    if (host.heartbeatTimer) return;
    const enabled = process.env.KAIRO_HEARTBEAT !== "false" && !host.isTestEnv();
    if (!enabled) return;
    host.heartbeatTimer = setInterval(() => {
        try {
            console.warn("[Heartbeat] alive");
        } catch {
            // ignore
        }
    }, 5000);
};

export const stopHeartbeat = (host: SmartContextRuntimeHost): void => {
    if (!host.heartbeatTimer) return;
    clearInterval(host.heartbeatTimer);
    host.heartbeatTimer = undefined;
};

export const startStoragePrune = (host: SmartContextRuntimeHost): void => {
    if (host.storagePruneTimer || host.isTestEnv()) return;
    const intervalMs = Number(process.env.KAIRO_STORAGE_PRUNE_INTERVAL_MS ?? "");
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
    const includeOnStart = process.env.KAIRO_STORAGE_PRUNE_ON_START === "true";
    const includeTempFiles = process.env.KAIRO_STORAGE_PRUNE_TEMP_FILES === "true";
    const compact = process.env.KAIRO_STORAGE_PRUNE_COMPACT === "true";

    const runPrune = async () => {
        if (host.storagePruneRunning) return;
        host.storagePruneRunning = true;
        try {
            const targets: StoragePruneTarget[] = ["evidence_packs", "chunk_summaries"];
            if (includeTempFiles && !targets.includes("temp_files")) {
                targets.push("temp_files");
            }
            const service = new StorageMaintenanceService(
                host.indexDatabase,
                host.documentSearchEngine
            );
            await service.prune({
                mode: "apply",
                targets,
                includeExpired: true,
                includeStale: true,
                enforceCaps: true,
                compact
            });
        } catch (error) {
            console.warn("[SmartContextServer] Background storage prune failed:", error);
        } finally {
            host.storagePruneRunning = false;
        }
    };

    host.storagePruneTimer = setInterval(runPrune, intervalMs);
    if (includeOnStart) {
        setImmediate(() => {
            void runPrune();
        });
    }
};

export const stopStoragePrune = (host: SmartContextRuntimeHost): void => {
    if (!host.storagePruneTimer) return;
    clearInterval(host.storagePruneTimer);
    host.storagePruneTimer = undefined;
};

export const shouldWarmupSearchIndex = (host: SmartContextRuntimeHost): boolean => {
    const enabled = (process.env.KAIRO_WARMUP_ENABLED ?? "true").toLowerCase();
    if (enabled === "false" || enabled === "0") return false;

    const maxFiles = Number(process.env.KAIRO_WARMUP_MAX_FILES ?? "");
    if (!Number.isFinite(maxFiles) || maxFiles <= 0) return true;

    const indexedFiles = host.indexDatabase.listFiles().length;
    if (indexedFiles === 0) {
        const allowEmpty = (process.env.KAIRO_WARMUP_ON_EMPTY_INDEX ?? "false").toLowerCase();
        return allowEmpty === "true" || allowEmpty === "1";
    }
    return indexedFiles <= maxFiles;
};

export const setupShutdownHooks = (host: SmartContextRuntimeHost): void => {
    if (host.isTestEnv()) return;
    const handle = (reason: string, error?: unknown) => {
        if (host.shutdownRequested) return;
        host.shutdownRequested = true;
        const timeoutMs = Number(process.env.KAIRO_SHUTDOWN_TIMEOUT_MS ?? 5000);
        if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
            host.shutdownTimer = setTimeout(() => {
                console.warn(`[Process] shutdown timeout exceeded (${timeoutMs}ms); forcing exit`);
                process.exit(1);
            }, timeoutMs);
            host.shutdownTimer.unref?.();
        }
        if (error) {
            console.warn(`[Process] shutdown requested (${reason})`, error);
        } else {
            console.warn(`[Process] shutdown requested (${reason})`);
        }
        void host.shutdown().finally(() => {
            if (host.shutdownTimer) {
                clearTimeout(host.shutdownTimer);
                host.shutdownTimer = undefined;
            }
            if (!host.isTestEnv()) {
                process.exit(0);
            }
        });
    };

    process.on("SIGTERM", () => handle("SIGTERM"));
    process.on("SIGINT", () => handle("SIGINT"));
    process.on("SIGHUP", () => handle("SIGHUP"));

    process.stdin.on("end", () => handle("stdin_end"));
    process.stdin.on("close", () => handle("stdin_close"));
    process.stdin.on("error", (err) => handle("stdin_error", err));
    process.stdin.resume();
};
