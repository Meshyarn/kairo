export type MetricType = "counter" | "gauge" | "histogram";
export type MetricLevel = "basic" | "detailed";

export type MetricSpec = {
    name: string;
    type: MetricType;
    unit?: "ms" | "bytes" | "count" | "ratio";
    level: MetricLevel;
    description: string;
};

export const METRICS_CATALOG: MetricSpec[] = [
    { name: "change.total_ms", type: "histogram", unit: "ms", level: "basic", description: "change pillar total latency" },
    { name: "write.total_ms", type: "histogram", unit: "ms", level: "basic", description: "write pillar total latency" },
    { name: "search.scout.total_ms", type: "histogram", unit: "ms", level: "basic", description: "file search total latency" },
    { name: "docs.search.total_ms", type: "histogram", unit: "ms", level: "basic", description: "document search total latency" },
    { name: "vector_index.query_ms", type: "histogram", unit: "ms", level: "basic", description: "vector index query latency" },
    { name: "vector_index.build_ms", type: "histogram", unit: "ms", level: "basic", description: "vector index build latency" },
    { name: "indexer.initial_scan_ms", type: "histogram", unit: "ms", level: "basic", description: "initial index scan latency" },
    { name: "indexer.incremental_scan_ms", type: "histogram", unit: "ms", level: "basic", description: "incremental index scan latency" },
    { name: "transactions.begin", type: "counter", unit: "count", level: "basic", description: "edit transaction starts" },
    { name: "transactions.commit", type: "counter", unit: "count", level: "basic", description: "edit transaction commits" },
    { name: "transactions.rollback", type: "counter", unit: "count", level: "basic", description: "edit transaction rollbacks" },
    { name: "docs.search.degraded_total", type: "counter", unit: "count", level: "basic", description: "document search degraded responses" },
    { name: "baseline.scan_ms", type: "histogram", unit: "ms", level: "basic", description: "baseline scan latency" },
    { name: "baseline.index_ms", type: "histogram", unit: "ms", level: "basic", description: "baseline indexing latency" },
    { name: "baseline.progress_ratio", type: "gauge", unit: "ratio", level: "basic", description: "baseline progress ratio" },
    { name: "baseline.pending_files", type: "gauge", unit: "count", level: "basic", description: "baseline pending files" },
    { name: "guardrails.blocked_total", type: "counter", unit: "count", level: "basic", description: "guardrails blocked results" },
    { name: "guardrails.warn_total", type: "counter", unit: "count", level: "basic", description: "guardrails warning results" },
    { name: "override.accepted_total", type: "counter", unit: "count", level: "basic", description: "guardrails override accepted" },
    { name: "override.rejected_total", type: "counter", unit: "count", level: "basic", description: "guardrails override rejected/expired/out-of-scope" },
    { name: "cache.cluster.hit_total", type: "counter", unit: "count", level: "basic", description: "cluster cache hits" },
    { name: "cache.cluster.miss_total", type: "counter", unit: "count", level: "basic", description: "cluster cache misses" },
    { name: "cache.docs_pack.hit_total", type: "counter", unit: "count", level: "basic", description: "document pack cache hits" },
    { name: "cache.docs_pack.miss_total", type: "counter", unit: "count", level: "basic", description: "document pack cache misses" },
    { name: "cache.evidence_summary.hit_total", type: "counter", unit: "count", level: "basic", description: "evidence summary cache hits" },
    { name: "cache.evidence_summary.miss_total", type: "counter", unit: "count", level: "basic", description: "evidence summary cache misses" },
    { name: "cache.invalidate.file_total", type: "counter", unit: "count", level: "basic", description: "file-level cache invalidations" },
    { name: "cache.invalidate.dir_total", type: "counter", unit: "count", level: "basic", description: "directory-level cache invalidations" },
    { name: "cache.invalidate.all_total", type: "counter", unit: "count", level: "basic", description: "full cache invalidations" },
    { name: "process.rss_bytes", type: "gauge", unit: "bytes", level: "basic", description: "process RSS usage" },
    { name: "process.heap_used_bytes", type: "gauge", unit: "bytes", level: "basic", description: "process heap used" },
    { name: "index.epoch", type: "gauge", unit: "count", level: "basic", description: "index epoch" },
    { name: "index.dirty_files", type: "gauge", unit: "count", level: "basic", description: "dirty file count" },
    { name: "index.coverage_ratio", type: "gauge", unit: "ratio", level: "basic", description: "index coverage ratio" },
    { name: "index.stale_risk_level", type: "gauge", unit: "count", level: "basic", description: "stale risk level (0-2)" },
    { name: "budget.index_dir_bytes", type: "gauge", unit: "bytes", level: "basic", description: "index directory bytes" },
    { name: "budget.storage_dir_bytes", type: "gauge", unit: "bytes", level: "basic", description: "storage directory bytes" },
    { name: "budget.symbol_secondary_index_bytes", type: "gauge", unit: "bytes", level: "basic", description: "symbol secondary index bytes" },
    { name: "symbol.search.secondary_index_enabled", type: "gauge", unit: "count", level: "basic", description: "symbol secondary index enabled" },
    { name: "indexer.queue_depth", type: "gauge", unit: "count", level: "basic", description: "indexer queue depth" },
    { name: "indexer.pause_ms", type: "gauge", unit: "ms", level: "basic", description: "indexer pause duration" },
    { name: "search.scout.results_count", type: "gauge", unit: "count", level: "basic", description: "scout search result count" }
];

export function getMetricsCatalog(level: MetricLevel = "basic"): MetricSpec[] {
    return METRICS_CATALOG.filter(spec => spec.level === "basic" || level === "detailed");
}

export function buildCatalogCoverage(
    snapshot: {
        counters: Record<string, number>;
        gauges: Record<string, number>;
        histograms: Record<string, { count: number }>;
    },
    level: MetricLevel = "basic"
): { required: number; present: number; missing: string[] } {
    const specs = getMetricsCatalog(level);
    const missing: string[] = [];
    let present = 0;

    for (const spec of specs) {
        const pool = spec.type === "counter"
            ? snapshot.counters
            : spec.type === "gauge"
                ? snapshot.gauges
                : snapshot.histograms;
        if (spec.name in pool) {
            present += 1;
        } else {
            missing.push(spec.name);
        }
    }

    return { required: specs.length, present, missing };
}
