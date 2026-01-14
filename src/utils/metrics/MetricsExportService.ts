import { metrics, type MetricsCollector } from "../MetricsCollector.js";
import { buildCatalogCoverage } from "../MetricsCatalog.js";
import { PathManager } from "../PathManager.js";
import type { IMetricsExporter, MetricsExportPayload } from "./IMetricsExporter.js";
import { JsonlExporter } from "./exporters/JsonlExporter.js";
import { StdoutExporter } from "./exporters/StdoutExporter.js";
import { OtelExporter } from "./exporters/OtelExporter.js";

type ExporterKind = "off" | "stdout" | "jsonl" | "otel";

export type MetricsExportStatus = {
    exporter: ExporterKind;
    enabled: boolean;
    intervalMs: number;
    available: boolean;
    missingReason?: string;
    lastError?: string;
    lastExportAt?: string;
};

export class MetricsExportService {
    private readonly collector: MetricsCollector;
    private readonly exporterKind: ExporterKind;
    private readonly intervalMs: number;
    private exporter?: IMetricsExporter;
    private timer?: NodeJS.Timeout;
    private status: MetricsExportStatus;

    constructor(options: { collector?: MetricsCollector; exporterKind?: ExporterKind; intervalMs?: number } = {}) {
        this.collector = options.collector ?? metrics;
        this.exporterKind = options.exporterKind ?? resolveExporterKind();
        this.intervalMs = options.intervalMs ?? resolveIntervalMs();
        this.status = {
            exporter: this.exporterKind,
            enabled: this.exporterKind !== "off",
            intervalMs: this.intervalMs,
            available: false
        };
    }

    public async start(): Promise<void> {
        if (this.exporterKind === "off") {
            this.status.available = false;
            return;
        }

        const { exporter, missingReason } = await this.createExporter();
        if (!exporter) {
            this.status.available = false;
            this.status.missingReason = missingReason;
            return;
        }

        this.exporter = exporter;
        this.status.available = true;
        this.status.missingReason = undefined;

        if (this.intervalMs > 0) {
            this.timer = setInterval(() => {
                void this.exportOnce();
            }, this.intervalMs);
            this.timer.unref?.();
            void this.exportOnce();
        }
    }

    public async stop(): Promise<void> {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        if (this.exporter?.shutdown) {
            await this.exporter.shutdown();
        }
    }

    public getStatus(): MetricsExportStatus {
        return { ...this.status };
    }

    public async exportOnce(): Promise<void> {
        if (!this.exporter) return;
        try {
            const snapshot = this.collector.snapshot();
            const payload: MetricsExportPayload = {
                ts: new Date().toISOString(),
                mode: this.collector.getMode(),
                ...snapshot,
                catalogCoverage: buildCatalogCoverage(snapshot, "basic")
            };
            await this.exporter.export(payload);
            this.status.lastExportAt = payload.ts;
            this.status.lastError = undefined;
        } catch (error: any) {
            this.status.lastError = error?.message ?? String(error);
        }
    }

    private async createExporter(): Promise<{ exporter?: IMetricsExporter; missingReason?: string }> {
        switch (this.exporterKind) {
            case "stdout":
                return { exporter: new StdoutExporter() };
            case "jsonl":
                return { exporter: new JsonlExporter(PathManager.getMetricsLogPath()) };
            case "otel": {
                const endpoint = (process.env.KAIRO_OTEL_ENDPOINT ?? "").trim();
                if (!endpoint) {
                    return { missingReason: "KAIRO_OTEL_ENDPOINT is required for OTLP export." };
                }
                const serviceName = (process.env.KAIRO_OTEL_SERVICE_NAME ?? "kairo").trim() || "kairo";
                const { exporter, missingReason } = await OtelExporter.createFromEnv({
                    endpoint,
                    serviceName,
                    exportIntervalMs: this.intervalMs > 0 ? this.intervalMs : 10_000
                });
                return { exporter, missingReason };
            }
            default:
                return { missingReason: "Metrics exporter disabled." };
        }
    }
}

function resolveExporterKind(): ExporterKind {
    const raw = (process.env.KAIRO_METRICS_EXPORTER ?? "off").trim().toLowerCase();
    if (raw === "stdout" || raw === "jsonl" || raw === "otel") {
        return raw;
    }
    return "off";
}

function resolveIntervalMs(): number {
    const raw = (process.env.KAIRO_METRICS_EXPORT_INTERVAL_MS ?? "").trim();
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return 0;
}
