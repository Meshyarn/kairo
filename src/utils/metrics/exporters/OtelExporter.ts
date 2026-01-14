import type { IMetricsExporter, MetricsExportPayload } from "../IMetricsExporter.js";
import { getMetricsCatalog } from "../../MetricsCatalog.js";

type OtelModules = {
    MeterProvider: any;
    PeriodicExportingMetricReader: any;
    OTLPMetricExporter: any;
    Resource: any;
    SemanticResourceAttributes: any;
};

type OtelConfig = {
    endpoint: string;
    serviceName: string;
    exportIntervalMs: number;
};

export class OtelExporter implements IMetricsExporter {
    name = "otel";
    private readonly provider: any;
    private readonly meter: any;
    private readonly counters = new Map<string, { instrument: any; lastValue: number }>();
    private readonly gaugeValues = new Map<string, number>();
    private readonly gaugeInstruments = new Map<string, any>();
    private readonly reader: any;

    private constructor(modules: OtelModules, config: OtelConfig) {
        const exporter = new modules.OTLPMetricExporter({ url: config.endpoint });
        this.reader = new modules.PeriodicExportingMetricReader({
            exporter,
            exportIntervalMillis: Math.max(1000, config.exportIntervalMs)
        });
        const resource = new modules.Resource({
            [modules.SemanticResourceAttributes.SERVICE_NAME]: config.serviceName
        });
        this.provider = new modules.MeterProvider({ resource });
        this.provider.addMetricReader(this.reader);
        this.meter = this.provider.getMeter("kairo.metrics");
    }

    static async createFromEnv(config: OtelConfig): Promise<{ exporter?: OtelExporter; missingReason?: string }> {
        try {
            const modules = await loadOtelModules();
            return { exporter: new OtelExporter(modules, config) };
        } catch (error: any) {
            return { missingReason: error?.message ?? "OTel exporter unavailable." };
        }
    }

    async export(payload: MetricsExportPayload): Promise<void> {
        const level = payload.mode === "detailed" ? "detailed" : "basic";
        const catalog = getMetricsCatalog(level);
        const allowedCounters = new Set(catalog.filter(spec => spec.type === "counter").map(spec => spec.name));
        const allowedGauges = new Set(catalog.filter(spec => spec.type === "gauge").map(spec => spec.name));
        const allowedHistograms = new Set(catalog.filter(spec => spec.type === "histogram").map(spec => spec.name));

        const filteredCounters: Record<string, number> = {};
        for (const [name, value] of Object.entries(payload.counters)) {
            if (allowedCounters.has(name)) {
                filteredCounters[name] = value;
            }
        }

        const filteredGauges: Record<string, number> = {};
        for (const [name, value] of Object.entries(payload.gauges)) {
            if (allowedGauges.has(name)) {
                filteredGauges[name] = value;
            }
        }

        const filteredHistograms: Record<string, { count: number; min?: number; max?: number; mean?: number; p50?: number; p95?: number; p99?: number }> = {};
        for (const [name, value] of Object.entries(payload.histograms)) {
            if (allowedHistograms.has(name)) {
                filteredHistograms[name] = value;
            }
        }

        this.recordCounters(filteredCounters);
        this.recordGauges(filteredGauges);
        this.recordHistograms(filteredHistograms);
        await this.provider.forceFlush();
    }

    async shutdown(): Promise<void> {
        await this.provider.shutdown();
    }

    private recordCounters(counters: Record<string, number>): void {
        for (const [name, value] of Object.entries(counters)) {
            const entry = this.counters.get(name) ?? {
                instrument: this.meter.createCounter(name),
                lastValue: 0
            };
            let delta = value - entry.lastValue;
            if (!Number.isFinite(delta) || delta < 0) {
                delta = value;
            }
            if (delta > 0) {
                entry.instrument.add(delta);
            }
            entry.lastValue = value;
            this.counters.set(name, entry);
        }
    }

    private recordGauges(gauges: Record<string, number>): void {
        for (const [name, value] of Object.entries(gauges)) {
            this.gaugeValues.set(name, value);
            this.ensureGauge(name);
        }
    }

    private recordHistograms(histograms: Record<string, { count: number; min?: number; max?: number; mean?: number; p50?: number; p95?: number; p99?: number }>): void {
        for (const [name, snapshot] of Object.entries(histograms)) {
            this.setHistogramGauge(name, "count", snapshot.count);
            this.setHistogramGauge(name, "min", snapshot.min);
            this.setHistogramGauge(name, "max", snapshot.max);
            this.setHistogramGauge(name, "mean", snapshot.mean);
            this.setHistogramGauge(name, "p50", snapshot.p50);
            this.setHistogramGauge(name, "p95", snapshot.p95);
            this.setHistogramGauge(name, "p99", snapshot.p99);
        }
    }

    private setHistogramGauge(baseName: string, suffix: string, value?: number): void {
        if (value === undefined) return;
        const name = `${baseName}.${suffix}`;
        this.gaugeValues.set(name, value);
        this.ensureGauge(name);
    }

    private ensureGauge(name: string): void {
        if (this.gaugeInstruments.has(name)) {
            return;
        }
        const instrument = this.meter.createObservableGauge(name, {}, (observableResult: any) => {
            observableResult.observe(this.gaugeValues.get(name) ?? 0);
        });
        this.gaugeInstruments.set(name, instrument);
    }
}

async function loadOtelModules(): Promise<OtelModules> {
    const sdk = await dynamicImport("@opentelemetry/sdk-metrics");
    const exporter = await dynamicImport("@opentelemetry/exporter-metrics-otlp-http");
    const resources = await dynamicImport("@opentelemetry/resources");
    const semantic = await dynamicImport("@opentelemetry/semantic-conventions");

    return {
        MeterProvider: sdk.MeterProvider,
        PeriodicExportingMetricReader: sdk.PeriodicExportingMetricReader,
        OTLPMetricExporter: exporter.OTLPMetricExporter,
        Resource: resources.Resource,
        SemanticResourceAttributes: semantic.SemanticResourceAttributes
    };
}

async function dynamicImport(moduleName: string): Promise<any> {
    const importer = new Function("moduleName", "return import(moduleName);");
    return importer(moduleName);
}
