import path from "path";
import type { StoredDocumentChunk } from "../../../indexing/DocumentChunkRepository.js";
import { isMetricsPath } from "../../../documents/search/SearchFilters.js";
import type { SymbolInfo } from "../../../types.js";
import type { NativeIndexDoc, NativeSearchCoreClient } from "./NativeSearchCore.js";

const MAX_SYMBOLS_PER_FILE = 500;
const MAX_CODE_FILE_BYTES = 512 * 1024;
const MAX_PENDING_OPS = 1000;
const COMMIT_DELAY_MS = 2000;
const BINARY_SAMPLE_BYTES = 8 * 1024;
const BINARY_NONPRINTABLE_RATIO = 0.1;

export class NativeSearchIndexer {
    private commitTimer?: NodeJS.Timeout;
    private readonly commitDelayMs: number;
    private pendingOps = 0;

    constructor(private readonly core: NativeSearchCoreClient) {
        this.commitDelayMs = COMMIT_DELAY_MS;
    }

    public upsertCodeFile(args: {
        repoId: string;
        filePath: string;
        content: string;
        contentHash?: string;
        mtimeMs?: number;
        symbols?: SymbolInfo[];
        callgraphRank?: number;
    }): void {
        const normalizedPath = normalizePath(args.filePath);
        if (!shouldIndexContent(args.content)) {
            try {
                this.core.deleteDoc({ kind: "code_file", repoId: args.repoId, path: normalizedPath });
            } catch {
                return;
            }
            this.scheduleCommit(1);
            return;
        }
        const symbols = Array.isArray(args.symbols)
            ? args.symbols.map((symbol) => String(symbol?.name ?? "")).filter(Boolean)
            : [];
        const limited = symbols.slice(0, MAX_SYMBOLS_PER_FILE);

        const doc: NativeIndexDoc = {
            kind: "code_file",
            repoId: args.repoId,
            path: normalizedPath,
            ext: normalizeExt(args.filePath),
            mtimeMs: args.mtimeMs,
            contentHash: args.contentHash,
            content: args.content,
            symbols: limited,
            pathDepth: computePathDepth(args.filePath),
            callgraphRank: Number.isFinite(args.callgraphRank as number) ? (args.callgraphRank as number) : 0
        };
        try {
            this.core.upsert(doc);
        } catch {
            return;
        }
        this.scheduleCommit(1);
    }

    public upsertDocChunks(args: {
        repoId: string;
        filePath: string;
        chunks: StoredDocumentChunk[];
    }): void {
        if (!Array.isArray(args.chunks) || args.chunks.length === 0) return;
        const docs: NativeIndexDoc[] = [];
        for (const chunk of args.chunks) {
            if (!chunk?.id || !chunk?.text) continue;
            const scope = resolveScope(chunk.filePath, chunk.kind);
            docs.push({
                kind: "doc_chunk",
                repoId: args.repoId,
                chunkId: chunk.id,
                docPath: normalizePath(chunk.filePath),
                headingPath: Array.isArray(chunk.sectionPath) ? chunk.sectionPath.map(String) : undefined,
                scope,
                text: chunk.text,
                mtimeMs: chunk.updatedAt,
                contentHash: chunk.contentHash
            });
        }
        try {
            this.core.upsertMany(docs);
        } catch {
            return;
        }
        this.scheduleCommit(docs.length);
    }

    public deleteCodeFile(repoId: string, filePath: string): void {
        try {
            this.core.deleteDoc({ kind: "code_file", repoId, path: normalizePath(filePath) });
        } catch {
            return;
        }
        this.scheduleCommit(1);
    }

    public deleteDocChunks(repoId: string, chunkIds: string[]): void {
        let deletedCount = 0;
        for (const chunkId of chunkIds ?? []) {
            if (!chunkId) continue;
            try {
                this.core.deleteDoc({ kind: "doc_chunk", repoId, chunkId });
                deletedCount += 1;
            } catch {
                // ignore
            }
        }
        if (deletedCount > 0) {
            this.scheduleCommit(deletedCount);
        }
    }

    public commit(): void {
        this.commitInternal();
    }

    public flush(): void {
        this.commitInternal();
    }

    private scheduleCommit(opCount: number): void {
        this.pendingOps += Math.max(1, opCount);
        if (this.pendingOps >= MAX_PENDING_OPS || this.commitDelayMs === 0) {
            this.commitInternal();
            return;
        }
        if (this.commitTimer) {
            clearTimeout(this.commitTimer);
        }
        this.commitTimer = setTimeout(() => {
            this.commitTimer = undefined;
            this.commitInternal();
        }, this.commitDelayMs);
        this.commitTimer.unref?.();
    }

    private commitInternal(): void {
        if (this.commitTimer) {
            clearTimeout(this.commitTimer);
            this.commitTimer = undefined;
        }
        if (this.pendingOps === 0) return;
        try {
            this.core.commit();
            this.pendingOps = 0;
        } catch {
            // best-effort retry later
            if (this.commitDelayMs > 0 && !this.commitTimer) {
                this.commitTimer = setTimeout(() => {
                    this.commitTimer = undefined;
                    this.commitInternal();
                }, this.commitDelayMs);
                this.commitTimer.unref?.();
            }
        }
    }
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}

function normalizeExt(filePath: string): string {
    return path.extname(filePath).replace(".", "").toLowerCase();
}

function computePathDepth(filePath: string): number {
    const normalized = normalizePath(filePath);
    const segments = normalized.split("/").filter(Boolean);
    return Math.max(0, segments.length - 1);
}

function shouldIndexContent(content: string): boolean {
    if (!content) return true;
    const sizeBytes = Buffer.byteLength(content, "utf8");
    if (sizeBytes > MAX_CODE_FILE_BYTES) {
        return false;
    }
    return !isBinaryContent(content);
}

function isBinaryContent(content: string): boolean {
    const sample = content.slice(0, BINARY_SAMPLE_BYTES);
    if (!sample) return false;
    const bytes = Buffer.from(sample, "utf8");
    let nonPrintable = 0;
    for (const byte of bytes) {
        if (byte === 0) return true;
        if (byte < 9 || (byte > 13 && byte < 32) || byte === 127) {
            nonPrintable += 1;
        }
    }
    return nonPrintable / bytes.length > BINARY_NONPRINTABLE_RATIO;
}

function resolveScope(filePath: string, kind: string): "docs" | "comments" | "logs" | "metrics" {
    if (kind === "code_comment") return "comments";
    if (isLogPath(filePath)) return "logs";
    if (isMetricsPath(filePath)) return "metrics";
    return "docs";
}

function isLogPath(filePath: string): boolean {
    const normalized = normalizePath(filePath);
    return /\.log$/i.test(normalized) || /\/logs?\//i.test(normalized);
}
