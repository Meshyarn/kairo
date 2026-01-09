export type IndexSnapshot = {
    epoch: number;
    indexedAt: number;
    coverageRatio: number;
    staleRisk: "low" | "medium" | "high";
    dirtyFileCount: number;
};

export type IndexingActivity = {
    phase: "idle" | "scanning" | "indexing" | "finalizing";
    processed: number;
    total: number;
    eta?: number;
};

type IndexTotals = {
    totalFiles: number;
    indexedFiles: number;
    lastIndexedAt?: number;
};

export class IndexStateManager {
    private epoch = 0;
    private lastIndexedAt = 0;
    private dirtyFiles = new Set<string>();
    private activity?: IndexingActivity;
    private totals?: IndexTotals;

    constructor(private readonly resolveTotals?: () => Promise<IndexTotals | null>) {}

    public markReindexStart(): void {
        this.activity = {
            phase: "scanning",
            processed: 0,
            total: 0
        };
    }

    public markReindexComplete(): void {
        this.epoch += 1;
        this.lastIndexedAt = Date.now();
        this.dirtyFiles.clear();
        this.activity = {
            phase: "idle",
            processed: 0,
            total: 0
        };
    }

    public markReindexFailed(): void {
        this.activity = {
            phase: "idle",
            processed: 0,
            total: 0
        };
    }

    public markDirty(filePath: string): void {
        if (!filePath) return;
        this.dirtyFiles.add(filePath);
    }

    public clearDirty(filePath?: string): void {
        if (filePath) {
            this.dirtyFiles.delete(filePath);
            return;
        }
        this.dirtyFiles.clear();
    }

    public updateTotals(totalFiles: number, indexedFiles: number, lastIndexedAt?: number): void {
        this.totals = { totalFiles, indexedFiles, lastIndexedAt };
        if (this.lastIndexedAt === 0 && lastIndexedAt) {
            this.lastIndexedAt = lastIndexedAt;
        }
    }

    public setActivity(activity?: IndexingActivity): void {
        this.activity = activity;
    }

    public getActivity(): IndexingActivity | undefined {
        return this.activity;
    }

    public async getSnapshot(): Promise<IndexSnapshot> {
        await this.refreshTotals();
        const total = this.totals?.totalFiles ?? 0;
        const indexed = this.totals?.indexedFiles ?? total;
        const dirtyCount = this.dirtyFiles.size;
        const safeTotal = total > 0 ? total : 0;
        const effectiveIndexed = Math.max(0, Math.min(safeTotal || indexed, indexed - dirtyCount));
        const coverageRatio = safeTotal > 0 ? effectiveIndexed / safeTotal : 1;

        return {
            epoch: this.epoch,
            indexedAt: this.lastIndexedAt,
            coverageRatio,
            staleRisk: this.calculateStaleRisk(dirtyCount, safeTotal),
            dirtyFileCount: dirtyCount
        };
    }

    private async refreshTotals(): Promise<void> {
        if (!this.resolveTotals) return;
        try {
            const totals = await this.resolveTotals();
            if (!totals) return;
            this.updateTotals(totals.totalFiles, totals.indexedFiles, totals.lastIndexedAt);
        } catch {
            // Keep last known totals on failure.
        }
    }

    private calculateStaleRisk(dirty: number, total: number): "low" | "medium" | "high" {
        if (total <= 0 || dirty <= 0) return "low";
        const ratio = dirty / total;
        if (ratio < 0.05) return "low";
        if (ratio < 0.15) return "medium";
        return "high";
    }
}
