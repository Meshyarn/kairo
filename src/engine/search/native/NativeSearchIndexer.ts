import path from "path";
import type { StoredDocumentChunk } from "../../../indexing/DocumentChunkRepository.js";
import { isMetricsPath } from "../../../documents/search/SearchFilters.js";
import type { SymbolInfo } from "../../../types.js";
import type { NativeIndexDoc, NativeSearchCoreClient } from "./NativeSearchCore.js";

const MAX_SYMBOLS_PER_FILE = 500;
const DEFAULT_COMMIT_DELAY_MS = 800;

export class NativeSearchIndexer {
    private commitTimer?: NodeJS.Timeout;
    private readonly commitDelayMs: number;

    constructor(private readonly core: NativeSearchCoreClient) {
        const rawDelay = Number(process.env.KAIRO_NATIVE_SEARCH_COMMIT_DELAY_MS ?? "");
        const delay = Number.isFinite(rawDelay) && rawDelay >= 0 ? Math.floor(rawDelay) : DEFAULT_COMMIT_DELAY_MS;
        this.commitDelayMs = Math.max(0, delay);
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
        const symbols = Array.isArray(args.symbols)
            ? args.symbols.map((symbol) => String(symbol?.name ?? "")).filter(Boolean)
            : [];
        const limited = symbols.slice(0, MAX_SYMBOLS_PER_FILE);

        const doc: NativeIndexDoc = {
            kind: "code_file",
            repoId: args.repoId,
            path: normalizePath(args.filePath),
            ext: normalizeExt(args.filePath),
            mtimeMs: args.mtimeMs,
            contentHash: args.contentHash,
            content: args.content,
            symbols: limited,
            pathDepth: computePathDepth(args.filePath),
            callgraphRank: Number.isFinite(args.callgraphRank as number) ? (args.callgraphRank as number) : 0
        };
        this.core.upsert(doc);
        this.scheduleCommit();
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
        this.core.upsertMany(docs);
        this.scheduleCommit();
    }

    public deleteCodeFile(repoId: string, filePath: string): void {
        this.core.deleteDoc({ kind: "code_file", repoId, path: normalizePath(filePath) });
        this.scheduleCommit();
    }

    public deleteDocChunks(repoId: string, chunkIds: string[]): void {
        let deleted = false;
        for (const chunkId of chunkIds ?? []) {
            if (!chunkId) continue;
            this.core.deleteDoc({ kind: "doc_chunk", repoId, chunkId });
            deleted = true;
        }
        if (deleted) {
            this.scheduleCommit();
        }
    }

    public commit(): void {
        this.core.commit();
    }

    public flush(): void {
        this.commit();
    }

    private scheduleCommit(): void {
        if (this.commitDelayMs === 0) {
            this.commit();
            return;
        }
        if (this.commitTimer) {
            clearTimeout(this.commitTimer);
        }
        this.commitTimer = setTimeout(() => {
            this.commitTimer = undefined;
            try {
                this.commit();
            } catch {
                // best-effort
            }
        }, this.commitDelayMs);
        this.commitTimer.unref?.();
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
