import type { HistogramSnapshot, MetricsMode } from "../MetricsCollector.js";

export type MetricsExportPayload = {
    ts: string;
    mode: MetricsMode;
    counters: Record<string, number>;
    gauges: Record<string, number>;
    histograms: Record<string, HistogramSnapshot>;
    catalogCoverage?: { required: number; present: number; missing: string[] };
};

export interface IMetricsExporter {
    name: string;
    export(payload: MetricsExportPayload): Promise<void>;
    shutdown?(): Promise<void>;
}
