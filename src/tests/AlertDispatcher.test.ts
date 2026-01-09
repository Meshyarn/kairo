import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { AlertDispatcher } from "../utils/AlertDispatcher.js";
import { AdaptiveFlowMetrics } from "../utils/AdaptiveFlowMetrics.js";

describe("AlertDispatcher", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alert-dispatcher-"));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("writes NDJSON logs and runs commands", async () => {
        const logDir = path.join(tempDir, "logs");
        const dispatcher = new AlertDispatcher({
            rootPath: tempDir,
            logDir,
            severity: "critical",
            channel: "adaptive-flow",
            command: 'node -e "process.exit(0)"'
        });

        const payload = {
            type: "ucg-memory",
            message: "Memory high",
            metrics: AdaptiveFlowMetrics.getMetrics()
        } as const;

        await dispatcher.dispatch(payload);

        const logPath = path.join(logDir, "adaptive-flow-alerts.ndjson");
        const entries = fs.readFileSync(logPath, "utf-8").trim().split(/\r?\n/);
        expect(entries.length).toBe(1);
        const record = JSON.parse(entries[0]);
        expect(record.channel).toBe("adaptive-flow");
        expect(record.severity).toBe("critical");
    });

    it("sends webhook payloads with mapped severity", async () => {
        const dispatcher = new AlertDispatcher({
            rootPath: tempDir,
            webhookUrl: "http://example.local/alert"
        });
        const postSpy = jest.spyOn(dispatcher as any, "postJson").mockResolvedValue(undefined);

        const payload = {
            type: "ucg-memory",
            message: "Memory high",
            metrics: AdaptiveFlowMetrics.getMetrics()
        } as const;

        await dispatcher.dispatch(payload);

        expect(postSpy).toHaveBeenCalledWith(
            "http://example.local/alert",
            expect.objectContaining({ severity: "error", message: "Memory high" })
        );
    });

    it("sends PagerDuty alerts", async () => {
        const dispatcher = new AlertDispatcher({
            rootPath: tempDir,
            pagerDutyRoutingKey: "pd-key-123"
        });
        const postSpy = jest.spyOn(dispatcher as any, "postJson").mockResolvedValue(undefined);

        const payload = {
            type: "l3-promotion-ratio",
            message: "High promotion",
            metrics: AdaptiveFlowMetrics.getMetrics()
        } as const;

        await dispatcher.dispatch(payload);

        expect(postSpy).toHaveBeenCalledWith(
            "https://events.pagerduty.com/v2/enqueue",
            expect.objectContaining({ 
                routing_key: "pd-key-123",
                payload: expect.objectContaining({ severity: "warning" })
            })
        );
    });

    it("handles command failure gracefully", async () => {
        const dispatcher = new AlertDispatcher({
            rootPath: tempDir,
            command: 'node -e "process.exit(1)"'
        });
        const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

        const payload = {
            type: "ucg-memory",
            message: "Fail command",
            metrics: AdaptiveFlowMetrics.getMetrics()
        } as const;

        await dispatcher.dispatch(payload);

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining("[AlertDispatcher] Failed to deliver alert:"),
            expect.any(Error)
        );
        consoleSpy.mockRestore();
    });

    it("maps various payload types to severity", () => {
        const dispatcher = new AlertDispatcher({ rootPath: tempDir }) as any;
        expect(dispatcher.mapSeverity("ucg-memory")).toBe("error");
        expect(dispatcher.mapSeverity("l3-promotion-ratio")).toBe("warning");
        expect(dispatcher.mapSeverity("unknown" as any)).toBe("warning");
    });
});
