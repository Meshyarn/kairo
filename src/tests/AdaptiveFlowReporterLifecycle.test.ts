import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { AdaptiveFlowReporter } from "../utils/AdaptiveFlowReporter.js";
import { AdaptiveFlowMetrics } from "../utils/AdaptiveFlowMetrics.js";

describe("AdaptiveFlowReporter lifecycle", () => {
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("flushes immediately and on interval when started", async () => {
        jest.useFakeTimers();
        const exportSpy = jest.spyOn(AdaptiveFlowMetrics, "exportToFile").mockImplementation(() => {});
        const reporter = new AdaptiveFlowReporter({
            rootPath: process.cwd(),
            exportIntervalMs: 50,
            enabled: true
        });

        reporter.start();
        expect(exportSpy).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(50);
        expect(exportSpy).toHaveBeenCalledTimes(2);

        reporter.stop();
        await jest.advanceTimersByTimeAsync(100);
        expect(exportSpy).toHaveBeenCalledTimes(2);
    });

    it("emits alerts when L3 promotion ratio exceeds threshold", () => {
        const alerts: string[] = [];
        const reporter = new AdaptiveFlowReporter({
            rootPath: process.cwd(),
            enabled: true,
            alertThresholds: { l3PromotionRatio: 0.01 },
            onAlert: payload => alerts.push(payload.type)
        });

        for (let i = 0; i < 5; i++) {
            AdaptiveFlowMetrics.recordPromotion(2, 3);
        }

        reporter.flush();

        expect(alerts).toContain("l3-promotion-ratio");
    });
});
