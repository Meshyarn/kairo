import fs from "fs";
import path from "path";
import { PathManager } from "./PathManager.js";

export type BetaTelemetryEvent = {
    ts?: string;
    tool: string;
    surface?: string;
    mode?: string;
    budget?: string;
    outputFormat?: string;
    status?: "ok" | "error";
    errorCode?: string;
    degraded?: boolean;
    degradedReasons?: string[];
    latencyMs?: number;
    responseTokens?: number;
    responseChars?: number;
    requestHash?: string;
    editsCount?: number;
    pathsCount?: number;
    targetFilesCount?: number;
    contractFindingCodes?: string[];
    hostName?: string;
};

export class BetaTelemetryLogger {
    private readonly logPath: string;
    private readonly hostName?: string;
    private readonly ready: Promise<void>;
    private loggedError = false;

    static fromEnv(rootPath: string): BetaTelemetryLogger | undefined {
        const enabled = process.env.KAIRO_BETA_LOG_ENABLED === "true"
            || typeof process.env.KAIRO_BETA_LOG_PATH === "string";
        if (!enabled) return undefined;
        const logDir = process.env.KAIRO_LOG_DIR ?? PathManager.resolveForRoot(rootPath, "logs");
        const logPath = process.env.KAIRO_BETA_LOG_PATH ?? path.join(logDir, "beta.ndjson");
        const hostName = process.env.KAIRO_HOST_NAME;
        return new BetaTelemetryLogger(logPath, hostName);
    }

    private constructor(logPath: string, hostName?: string) {
        this.logPath = logPath;
        this.hostName = hostName;
        const dir = path.dirname(logPath);
        this.ready = fs.promises.mkdir(dir, { recursive: true }).then(() => undefined);
    }

    record(event: BetaTelemetryEvent): void {
        const payload = {
            ...event,
            ts: event.ts ?? new Date().toISOString(),
            ...(this.hostName ? { hostName: this.hostName } : {})
        };
        void this.appendLine(payload);
    }

    private async appendLine(payload: Record<string, unknown>): Promise<void> {
        try {
            await this.ready;
            await fs.promises.appendFile(this.logPath, `${JSON.stringify(payload)}\n`, "utf-8");
        } catch (error) {
            if (!this.loggedError) {
                this.loggedError = true;
                console.warn("[BetaTelemetryLogger] Failed to write beta telemetry log:", error);
            }
        }
    }
}
