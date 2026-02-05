import type { StoredEvidencePack } from "./EvidencePackRepository.js";
import type { IndexDatabase } from "./IndexDatabase.js";
import type { DocumentSearchEngine } from "../documents/search/DocumentSearchEngine.js";
import type { FlowArtifactManager } from "../orchestration/flow-artifact-manager.js";
import type { WarningV1 } from "../types/guidance.js";
import { metrics } from "../utils/MetricsCollector.js";
import { PathManager } from "../utils/PathManager.js";
import * as fs from "fs";
import * as path from "path";
import {
    applyCap,
    cleanupEmptyDirs,
    coerceEvidencePack,
    collectTempEntries,
    estimateBytes,
    isPackStale,
    isSummaryStale,
    resolveLimit
} from "./StorageMaintenanceUtils.js";

export type StoragePruneMode = "plan" | "apply";
export type StoragePruneTarget = "evidence_packs" | "chunk_summaries" | "flow_artifacts" | "temp_files";

export type StoragePruneOptions = {
    mode?: StoragePruneMode;
    targets?: StoragePruneTarget[];
    includeExpired?: boolean;
    includeStale?: boolean;
    enforceCaps?: boolean;
    compact?: boolean;
    limits?: {
        maxPacks?: number;
        maxPackBytes?: number;
        maxSummaryChunks?: number;
        maxSummaryBytes?: number;
    };
    flowArtifacts?: {
        removeOrphans?: boolean;
    };
    tempFiles?: {
        maxAgeMs?: number;
        maxFiles?: number;
    };
};

export type EvidencePackPruneReport = {
    beforeCount: number;
    afterCount: number;
    deleted: Record<string, number>;
    bytesBefore?: number;
    bytesAfter?: number;
    sample?: string[];
};

export type SummaryPruneReport = {
    beforeChunks: number;
    afterChunks: number;
    deleted: Record<string, number>;
    bytesBefore?: number;
    bytesAfter?: number;
};

export type FlowArtifactPruneReport = {
    prunedInMemory: number;
    deletedFiles?: number;
    fixedIndexEntries?: number;
    removedSessions?: number;
};

export type TempFilePruneReport = {
    basePaths: string[];
    beforeCount: number;
    afterCount: number;
    deleted: number;
    bytesBefore?: number;
    bytesAfter?: number;
    sample?: string[];
};

export type StoragePruneReport = {
    startedAt: string;
    finishedAt: string;
    targets: StoragePruneTarget[];
    evidencePacks?: EvidencePackPruneReport;
    summaries?: SummaryPruneReport;
    flowArtifacts?: FlowArtifactPruneReport;
    tempFiles?: TempFilePruneReport;
};

export type StoragePruneResult = {
    success: boolean;
    output: string;
    mode: StoragePruneMode;
    report: StoragePruneReport;
    warnings?: WarningV1[];
};

type PackEntry = {
    packId: string;
    pack: StoredEvidencePack | null;
    sizeBytes: number;
    createdAt: number;
    expiresAt?: number;
    corrupt?: boolean;
};

type SummaryEntry = {
    chunkId: string;
    styles: Record<"preview" | "summary", { summary: string; contentHash?: string }>;
    sizeBytes: number;
    updatedAt: number;
    orphan?: boolean;
    stale?: boolean;
    corrupt?: boolean;
};

export class StorageMaintenanceService {
    constructor(
        private readonly indexDb: IndexDatabase,
        private readonly documentSearchEngine?: DocumentSearchEngine,
        private readonly flowArtifactManager?: FlowArtifactManager
    ) {}

    public async prune(options: StoragePruneOptions = {}): Promise<StoragePruneResult> {
        const mode: StoragePruneMode = options.mode === "plan" ? "plan" : "apply";
        const targets: StoragePruneTarget[] = (options.targets && options.targets.length > 0)
            ? options.targets
            : ["evidence_packs", "chunk_summaries", "flow_artifacts"];
        const report: StoragePruneReport = {
            startedAt: new Date().toISOString(),
            finishedAt: "",
            targets
        };
        const warnings: WarningV1[] = [];

        if (targets.includes("evidence_packs")) {
            report.evidencePacks = this.pruneEvidencePacks(options, mode, warnings);
        }
        if (targets.includes("chunk_summaries")) {
            report.summaries = this.pruneSummaries(options, mode, warnings);
        }
        if (targets.includes("flow_artifacts")) {
            report.flowArtifacts = await this.pruneFlowArtifacts(options, mode, warnings);
        }
        if (targets.includes("temp_files")) {
            report.tempFiles = await this.pruneTempFiles(options, mode, warnings);
        }

        report.finishedAt = new Date().toISOString();

        return {
            success: true,
            output: mode === "plan" ? "Prune plan generated." : "Prune completed.",
            mode,
            report,
            warnings: warnings.length > 0 ? warnings : undefined
        };
    }

    private pruneEvidencePacks(options: StoragePruneOptions, mode: StoragePruneMode, warnings: WarningV1[]): EvidencePackPruneReport {
        const includeExpired = options.includeExpired !== false;
        const includeStale = options.includeStale !== false;
        const enforceCaps = options.enforceCaps !== false;
        const maxPacks = resolveLimit(options.limits?.maxPacks, "KAIRO_EVIDENCE_PACK_MAX_COUNT", 300);
        const maxBytes = resolveLimit(options.limits?.maxPackBytes, "KAIRO_EVIDENCE_PACK_MAX_BYTES", 100 * 1024 * 1024);
        const staleCheckLimit = resolveLimit(undefined, "KAIRO_EVIDENCE_PACK_STALE_CHECK_MAX_ITEMS", 24);
        const now = Date.now();

        const entries: PackEntry[] = [];
        this.indexDb.iterateEvidencePacks((packId, payload) => {
            const sizeBytes = estimateBytes(payload);
            const pack = coerceEvidencePack(payload);
            if (!pack) {
                warnings.push({
                    severity: "warning",
                    code: "storage_corrupt_pack",
                    message: `Corrupt evidence pack payload for ${packId}; pruning will drop it.`,
                    affectedTargets: [packId]
                });
                entries.push({
                    packId,
                    pack: null,
                    sizeBytes,
                    createdAt: 0,
                    corrupt: true
                });
                return;
            }
            entries.push({
                packId: packId || pack.packId,
                pack,
                sizeBytes,
                createdAt: Number.isFinite(pack.createdAt) ? pack.createdAt : 0,
                expiresAt: pack.expiresAt
            });
        });

        const deletedByReason: Record<string, number> = {};
        const deletedIds = new Set<string>();
        const deleteReason = (reason: string) => {
            deletedByReason[reason] = (deletedByReason[reason] ?? 0) + 1;
        };

        for (const entry of entries) {
            if (!entry.pack || entry.corrupt) {
                deletedIds.add(entry.packId);
                deleteReason("corrupt");
                continue;
            }
            if (includeExpired && entry.expiresAt && entry.expiresAt <= now) {
                deletedIds.add(entry.packId);
                deleteReason("expired");
                continue;
            }
            if (includeStale && isPackStale(this.indexDb, entry.pack, staleCheckLimit)) {
                deletedIds.add(entry.packId);
                deleteReason("stale");
            }
        }

        let remaining = entries.filter(entry => !deletedIds.has(entry.packId));

        if (enforceCaps && maxPacks > 0 && remaining.length > maxPacks) {
            remaining = applyCap(
                remaining,
                maxPacks,
                (entry) => entry.createdAt,
                (entry) => entry.packId,
                deletedIds,
                deleteReason,
                "cap"
            );
        }

        if (enforceCaps && maxBytes > 0) {
            let totalBytes = remaining.reduce((sum, entry) => sum + entry.sizeBytes, 0);
            if (totalBytes > maxBytes) {
                const sorted = [...remaining].sort((a, b) => a.createdAt - b.createdAt);
                for (const entry of sorted) {
                    if (totalBytes <= maxBytes) break;
                    if (deletedIds.has(entry.packId)) continue;
                    deletedIds.add(entry.packId);
                    deleteReason("cap_bytes");
                    totalBytes -= entry.sizeBytes;
                }
                remaining = remaining.filter(entry => !deletedIds.has(entry.packId));
            }
        }

        if (mode === "apply") {
            for (const packId of deletedIds) {
                this.indexDb.deleteEvidencePack(packId);
            }
            if (options.compact) {
                this.indexDb.compactEvidencePacks();
            }
            if (deletedIds.size > 0) {
                this.documentSearchEngine?.evictPackCache(Array.from(deletedIds));
            }
            metrics.gauge("storage.packs.count", remaining.length);
            metrics.inc("storage.packs.pruned_total", deletedIds.size);
        }

        const bytesBefore = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
        const bytesAfter = remaining.reduce((sum, entry) => sum + entry.sizeBytes, 0);

        return {
            beforeCount: entries.length,
            afterCount: remaining.length,
            deleted: deletedByReason,
            bytesBefore,
            bytesAfter,
            sample: Array.from(deletedIds).slice(0, 10)
        };
    }

    private pruneSummaries(options: StoragePruneOptions, mode: StoragePruneMode, warnings: WarningV1[]): SummaryPruneReport {
        const includeStale = options.includeStale !== false;
        const enforceCaps = options.enforceCaps !== false;
        const maxChunks = resolveLimit(options.limits?.maxSummaryChunks, "KAIRO_CHUNK_SUMMARY_MAX_CHUNKS", 20000);
        const maxBytes = resolveLimit(options.limits?.maxSummaryBytes, "KAIRO_CHUNK_SUMMARY_MAX_BYTES", 100 * 1024 * 1024);

        const entries: SummaryEntry[] = [];
        this.indexDb.iterateChunkSummaries((chunkId, styles) => {
            const chunk = this.indexDb.getDocumentChunk(chunkId);
            const sizeBytes = estimateBytes(styles);
            if (!styles || Object.keys(styles).length === 0) {
                warnings.push({
                    severity: "warning",
                    code: "storage_corrupt_summary",
                    message: `Empty summary payload for ${chunkId}; pruning will drop it.`,
                    affectedTargets: [chunkId]
                });
                entries.push({ chunkId, styles, sizeBytes, updatedAt: 0, corrupt: true });
                return;
            }
            if (!chunk) {
                entries.push({ chunkId, styles, sizeBytes, updatedAt: 0, orphan: true });
                return;
            }
            const stale = includeStale ? isSummaryStale(chunk.contentHash, styles) : false;
            entries.push({
                chunkId,
                styles,
                sizeBytes,
                updatedAt: chunk.updatedAt ?? 0,
                stale
            });
        });

        const deletedByReason: Record<string, number> = {};
        const deletedIds = new Set<string>();
        const deleteReason = (reason: string) => {
            deletedByReason[reason] = (deletedByReason[reason] ?? 0) + 1;
        };

        for (const entry of entries) {
            if (entry.corrupt) {
                deletedIds.add(entry.chunkId);
                deleteReason("corrupt");
                continue;
            }
            if (entry.orphan) {
                deletedIds.add(entry.chunkId);
                deleteReason("orphan");
                continue;
            }
            if (entry.stale) {
                deletedIds.add(entry.chunkId);
                deleteReason("stale");
            }
        }

        let remaining = entries.filter(entry => !deletedIds.has(entry.chunkId));

        if (enforceCaps && maxChunks > 0 && remaining.length > maxChunks) {
            remaining = applyCap(
                remaining,
                maxChunks,
                (entry) => entry.updatedAt,
                (entry) => entry.chunkId,
                deletedIds,
                deleteReason,
                "cap"
            );
        }

        if (enforceCaps && maxBytes > 0) {
            let totalBytes = remaining.reduce((sum, entry) => sum + entry.sizeBytes, 0);
            if (totalBytes > maxBytes) {
                const sorted = [...remaining].sort((a, b) => a.updatedAt - b.updatedAt);
                for (const entry of sorted) {
                    if (totalBytes <= maxBytes) break;
                    if (deletedIds.has(entry.chunkId)) continue;
                    deletedIds.add(entry.chunkId);
                    deleteReason("cap_bytes");
                    totalBytes -= entry.sizeBytes;
                }
                remaining = remaining.filter(entry => !deletedIds.has(entry.chunkId));
            }
        }

        if (mode === "apply") {
            for (const chunkId of deletedIds) {
                this.indexDb.deleteChunkSummaries(chunkId);
            }
            if (options.compact) {
                this.indexDb.compactChunkSummaries();
            }
            metrics.gauge("storage.summaries.chunks", remaining.length);
            metrics.inc("storage.summaries.pruned_total", deletedIds.size);
        }

        const bytesBefore = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
        const bytesAfter = remaining.reduce((sum, entry) => sum + entry.sizeBytes, 0);

        return {
            beforeChunks: entries.length,
            afterChunks: remaining.length,
            deleted: deletedByReason,
            bytesBefore,
            bytesAfter
        };
    }

    private async pruneFlowArtifacts(
        options: StoragePruneOptions,
        mode: StoragePruneMode,
        warnings: WarningV1[]
    ): Promise<FlowArtifactPruneReport> {
        if (!this.flowArtifactManager) {
            return { prunedInMemory: 0 };
        }
        if (mode === "plan") {
            const planned = await this.flowArtifactManager.planPrunePersisted({
                removeOrphans: options.flowArtifacts?.removeOrphans !== false
            });
            return {
                prunedInMemory: 0,
                deletedFiles: planned.deletedFiles,
                fixedIndexEntries: planned.fixedIndexEntries,
                removedSessions: planned.removedSessions
            };
        }
        const prunedInMemory = this.flowArtifactManager.prune();
        const persisted = await this.flowArtifactManager.prunePersisted({
            removeOrphans: options.flowArtifacts?.removeOrphans !== false
        });
        return {
            prunedInMemory,
            deletedFiles: persisted.deletedFiles,
            fixedIndexEntries: persisted.fixedIndexEntries,
            removedSessions: persisted.removedSessions
        };
    }

    private async pruneTempFiles(
        options: StoragePruneOptions,
        mode: StoragePruneMode,
        warnings: WarningV1[]
    ): Promise<TempFilePruneReport> {
        const maxAgeMs = resolveLimit(options.tempFiles?.maxAgeMs, "KAIRO_TEMP_FILE_TTL_MS", 7 * 24 * 60 * 60 * 1000);
        const maxFiles = resolveLimit(options.tempFiles?.maxFiles, "KAIRO_TEMP_FILE_MAX_COUNT", 0);
        const rootPath = PathManager.getRootPath();
        const basePaths = Array.from(
            new Set([
                PathManager.getTmpDir(),
                PathManager.getTempDir()
            ].map((p) => path.resolve(p)))
        );
        const entries: Array<{ filePath: string; size: number; mtimeMs: number }> = [];

        for (const basePath of basePaths) {
            const collected = await collectTempEntries(basePath);
            entries.push(...collected);
        }

        const beforeCount = entries.length;
        const bytesBefore = entries.reduce((total, entry) => total + entry.size, 0);
        const now = Date.now();
        let candidates = entries.filter((entry) => maxAgeMs > 0 && now - entry.mtimeMs >= maxAgeMs);

        if (maxFiles > 0 && candidates.length > maxFiles) {
            candidates = candidates
                .sort((a, b) => a.mtimeMs - b.mtimeMs)
                .slice(0, candidates.length - maxFiles);
        }

        const deleted: string[] = [];
        if (mode === "apply") {
            for (const entry of candidates) {
                try {
                    await fs.promises.unlink(entry.filePath);
                    deleted.push(entry.filePath);
                } catch (error: any) {
                    warnings.push({
                        severity: "warning",
                        code: "temp_file_prune_failed",
                        message: `Failed to delete temp file: ${entry.filePath} (${error?.message ?? String(error)})`,
                        affectedTargets: [entry.filePath]
                    });
                }
            }
            for (const basePath of basePaths) {
                await cleanupEmptyDirs(basePath);
            }
        }

        const deletedSet = new Set(deleted);
        const remaining = entries.filter((entry) => !deletedSet.has(entry.filePath));
        const afterCount = remaining.length;
        const bytesAfter = remaining.reduce((total, entry) => total + entry.size, 0);

        return {
            basePaths: basePaths.map((p) => path.relative(rootPath, p) || p),
            beforeCount,
            afterCount,
            deleted: deleted.length,
            bytesBefore,
            bytesAfter,
            sample: deleted.slice(0, 10).map((filePath) => path.relative(rootPath, filePath) || filePath)
        };
    }
}

