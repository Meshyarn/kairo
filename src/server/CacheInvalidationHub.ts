import * as path from "path";
import type { DependencyGraph } from "../ast/DependencyGraph.js";
import type { CallGraphBuilder } from "../ast/CallGraphBuilder.js";
import type { TypeDependencyTracker } from "../ast/TypeDependencyTracker.js";
import type { DocumentIndexer } from "../indexing/DocumentIndexer.js";
import type { IndexStateManager } from "../indexing/IndexStateManager.js";
import type { SearchEngine } from "../engine/Search.js";
import type { ClusterSearchEngine } from "../engine/ClusterSearch/index.js";
import type { DocumentSearchEngine } from "../documents/search/DocumentSearchEngine.js";
import type { CachingStrategy } from "../orchestration/CachingStrategy.js";
import { metrics } from "../utils/MetricsCollector.js";

export type FreshnessEvent =
    | { type: "file_changed"; absPath: string }
    | { type: "file_deleted"; absPath: string }
    | { type: "dir_deleted"; absPath: string }
    | { type: "ignore_changed" }
    | { type: "reindex_start" }
    | { type: "reindex_complete" };

export class CacheInvalidationHub {
    constructor(private readonly args: {
        rootPath: string;
        indexStateManager: IndexStateManager;
        searchEngine: SearchEngine;
        dependencyGraph: DependencyGraph;
        clusterSearchEngine: ClusterSearchEngine;
        documentSearchEngine: DocumentSearchEngine;
        documentIndexer?: DocumentIndexer;
        orchestrationCache?: CachingStrategy;
        callGraphBuilder?: CallGraphBuilder;
        typeDependencyTracker?: TypeDependencyTracker;
    }) {}

    public onEvent(event: FreshnessEvent): void {
        switch (event.type) {
            case "file_changed":
                metrics.inc("cache.invalidate.file_total");
                void this.handleFileChanged(event.absPath);
                void this.refreshIndexMetrics();
                break;
            case "file_deleted":
                metrics.inc("cache.invalidate.file_total");
                void this.handleFileDeleted(event.absPath);
                void this.refreshIndexMetrics();
                break;
            case "dir_deleted":
                metrics.inc("cache.invalidate.dir_total");
                void this.handleDirDeleted(event.absPath);
                void this.refreshIndexMetrics();
                break;
            case "ignore_changed":
                metrics.inc("cache.invalidate.all_total");
                this.handleIgnoreChanged();
                void this.refreshIndexMetrics();
                break;
            case "reindex_start":
                metrics.inc("cache.invalidate.all_total");
                this.handleReindexStart();
                void this.refreshIndexMetrics();
                break;
            case "reindex_complete":
                metrics.inc("cache.invalidate.all_total");
                void this.handleReindexComplete();
                void this.refreshIndexMetrics();
                break;
            default:
                break;
        }
    }

    public async syncEpoch(): Promise<void> {
        await this.updateEpoch();
    }

    private async handleFileChanged(absPath: string): Promise<void> {
        const normalized = this.normalize(absPath);
        await this.args.searchEngine.invalidateFile(normalized);
        await this.args.dependencyGraph.invalidateFile(normalized);
        this.args.clusterSearchEngine.invalidateFile(normalized);
        this.args.callGraphBuilder?.invalidateFile(normalized);
        this.args.typeDependencyTracker?.invalidateFile(normalized);
        this.args.orchestrationCache?.clear();
    }

    private async handleFileDeleted(absPath: string): Promise<void> {
        const normalized = this.normalize(absPath);
        await this.args.searchEngine.invalidateFile(normalized);
        await this.args.dependencyGraph.removeFile(normalized);
        this.args.clusterSearchEngine.invalidateFile(normalized);
        this.args.callGraphBuilder?.invalidateFile(normalized);
        this.args.typeDependencyTracker?.invalidateFile(normalized);
        this.args.orchestrationCache?.clear();
    }

    private async handleDirDeleted(absPath: string): Promise<void> {
        const normalized = this.normalize(absPath);
        await this.args.searchEngine.invalidateDirectory(normalized);
        await this.args.dependencyGraph.removeDirectory(normalized);
        this.args.clusterSearchEngine.invalidateDirectory(normalized);
        this.args.callGraphBuilder?.invalidateDirectory(normalized);
        this.args.typeDependencyTracker?.invalidateDirectory(normalized);
        this.args.documentSearchEngine.evictPackCache();
        this.args.orchestrationCache?.clear();
    }

    private handleIgnoreChanged(): void {
        this.args.clusterSearchEngine.clearCache();
        this.args.documentSearchEngine.evictPackCache();
        this.args.orchestrationCache?.clear();
    }

    private handleReindexStart(): void {
        this.args.clusterSearchEngine.clearCache();
        this.args.documentSearchEngine.evictPackCache();
        this.args.orchestrationCache?.clear();
    }

    private async handleReindexComplete(): Promise<void> {
        this.args.clusterSearchEngine.clearCache();
        this.args.documentSearchEngine.evictPackCache();
        this.args.orchestrationCache?.clear();
        await this.updateEpoch();
    }

    private async updateEpoch(): Promise<void> {
        try {
            const snapshot = await this.args.indexStateManager.getSnapshot();
            this.args.orchestrationCache?.setEpoch(snapshot.epoch);
        } catch {
            // best-effort
        }
    }

    private async refreshIndexMetrics(): Promise<void> {
        try {
            const snapshot = await this.args.indexStateManager.getSnapshot();
            metrics.gauge("index.epoch", snapshot.epoch);
            metrics.gauge("index.dirty_files", snapshot.dirtyFileCount);
            metrics.gauge("index.coverage_ratio", snapshot.coverageRatio);
            const riskLevel = snapshot.staleRisk === "high" ? 2 : snapshot.staleRisk === "medium" ? 1 : 0;
            metrics.gauge("index.stale_risk_level", riskLevel);
        } catch {
            // best-effort
        }
    }

    private normalize(absPath: string): string {
        if (!absPath) return absPath;
        return path.isAbsolute(absPath) ? absPath : path.resolve(this.args.rootPath, absPath);
    }
}
