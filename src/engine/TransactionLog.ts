import { createLogger } from "../utils/StructuredLogger.js";
import { metrics } from "../utils/MetricsCollector.js";
import { IndexDatabase } from "../indexing/IndexDatabase.js";
import { PatienceDiff } from "./PatienceDiff.js";
import { PatchStore, type PatchFormat } from "./PatchStore.js";
import type { EditOperation } from "../types.js";

export interface TransactionSnapshot {
    filePath: string;
    originalExists?: boolean;
    originalContent: string;
    originalHash: string;
    newExists?: boolean;
    newContent?: string;
    newHash?: string;
}

export type TransactionStatus = "pending" | "committed" | "rolled_back";

export interface TransactionLogEntry {
    id: string;
    timestamp: number;
    status: TransactionStatus;
    description: string;
    snapshots: TransactionSnapshot[];
    diffSummary?: TransactionDiffSummary;
    filesTouched?: TransactionFileSummary[];
    patchRef?: string;
    patchFormat?: PatchFormat;
}

export interface TransactionDiffSummary {
    fileCount: number;
    linesAdded: number;
    linesDeleted: number;
    linesChanged: number;
    skippedFiles?: number;
}

export interface TransactionFileSummary {
    path: string;
    beforeHash?: string;
    afterHash?: string;
    bytesBefore?: number;
    bytesAfter?: number;
}

export class TransactionLog {
    private readonly logger = createLogger("TransactionLog");

    constructor(private readonly store: IndexDatabase, private readonly patchStore?: PatchStore) {}

    public begin(id: string, description: string, snapshots: TransactionSnapshot[]): void {
        const entry: TransactionLogEntry = {
            id,
            timestamp: Date.now(),
            status: "pending",
            description,
            snapshots
        };
        this.store.upsertPendingTransaction(entry);
        metrics.inc("transactions.begin");
        this.logger.info("Transaction begun", { transactionId: id, fileCount: snapshots.length });
    }

    public async commit(id: string, snapshots: TransactionSnapshot[], options?: { operations?: EditOperation[] }): Promise<void> {
        const pending = this.store.listPendingTransactions().find(entry => entry.id === id);
        const summary = this.buildDiffSummary(snapshots);
        const filesTouched = this.buildFileSummaries(snapshots);
        let patchRef: string | undefined;
        let patchFormat: PatchFormat | undefined;
        if (this.patchStore) {
            try {
                const stored = await this.patchStore.storePatch({
                    snapshots,
                    operations: options?.operations,
                    diffSummary: summary,
                    filesTouched
                });
                patchRef = stored.patchRef;
                patchFormat = stored.patchFormat;
                metrics.inc("transactions.patch_stored");
            } catch (error: any) {
                metrics.inc("transactions.patch_store_failed");
                this.logger.warn("Patch store failed", { transactionId: id, error: error?.message ?? "unknown" });
            }
        }
        const entry: TransactionLogEntry = {
            id,
            timestamp: pending?.timestamp ?? Date.now(),
            status: "committed",
            description: pending?.description ?? "committed",
            snapshots,
            diffSummary: summary,
            filesTouched,
            patchRef,
            patchFormat
        };
        this.store.markTransactionCommitted(id, entry);
        metrics.inc("transactions.commit");
        this.logger.info("Transaction committed", { transactionId: id, fileCount: snapshots.length });
    }

    public rollback(id: string): void {
        this.store.markTransactionRolledBack(id);
        metrics.inc("transactions.rollback");
        this.logger.warn("Transaction rolled back", { transactionId: id });
    }

    public getPendingTransactions(): TransactionLogEntry[] {
        const pending = this.store.listPendingTransactions();
        metrics.gauge("transactions.pending", pending.length);
        return pending;
    }

    public listTransactions(options?: { status?: TransactionStatus; limit?: number }): TransactionLogEntry[] {
        return this.store.listTransactions(options);
    }

    private buildDiffSummary(snapshots: TransactionSnapshot[]): TransactionDiffSummary {
        let linesAdded = 0;
        let linesDeleted = 0;
        let linesChanged = 0;
        let skippedFiles = 0;
        const maxBytes = 200_000;
        for (const snapshot of snapshots) {
            const before = snapshot.originalContent ?? "";
            const after = snapshot.newContent ?? "";
            if (before.length + after.length > maxBytes) {
                skippedFiles += 1;
                continue;
            }
            const hunks = PatienceDiff.diff(before, after, { contextLines: 3 });
            const summary = PatienceDiff.summarize(hunks);
            linesAdded += summary.added;
            linesDeleted += summary.removed;
            linesChanged += summary.changed;
        }
        return {
            fileCount: snapshots.length,
            linesAdded,
            linesDeleted,
            linesChanged,
            ...(skippedFiles > 0 ? { skippedFiles } : {})
        };
    }

    private buildFileSummaries(snapshots: TransactionSnapshot[]): TransactionFileSummary[] {
        return snapshots.map(snapshot => ({
            path: snapshot.filePath,
            beforeHash: snapshot.originalHash,
            afterHash: snapshot.newHash,
            bytesBefore: snapshot.originalContent?.length ?? 0,
            bytesAfter: snapshot.newContent?.length ?? 0
        }));
    }
}
