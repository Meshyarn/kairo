import * as fs from "fs";
import { LRUCache } from "lru-cache";
import type { EmbeddingKey, StoredEmbedding } from "./IndexStore.js";
import { getPackPaths, type PackPaths, resolveEmbeddingPackDir } from "./EmbeddingPackPaths.js";
import {
    loadIndexFromDisk,
    readF32Embedding,
    readQ8Embedding,
    scanF32,
    scanQ8,
    writeIndexBin,
    writeJsonAtomic,
    readJson
} from "./EmbeddingPackIO.js";
import { dequantizeQ8, quantizeQ8 } from "./EmbeddingPackQuantize.js";

export type EmbeddingPackFormat = "float32" | "q8" | "both";

export type EmbeddingPackMeta = {
    version: 1;
    provider: string;
    model: string;
    dims: number;
    format: EmbeddingPackFormat;
    count: number;
    createdAt: string;
    updatedAt: string;
};

export type EmbeddingPackIndexV1 = {
    version: 1;
    provider: string;
    model: string;
    dims: number;
    format: EmbeddingPackFormat;
    f32?: Record<string, number>;
    q8?: Record<string, number>;
};

export type EmbeddingPackConfig = {
    enabled: boolean;
    format: EmbeddingPackFormat;
    rebuild: "auto" | "on_start" | "manual";
    index: "json" | "bin";
    cacheBytes: number;
};

export function resolveEmbeddingPackConfigFromEnv(): EmbeddingPackConfig {
    const rawFormat = (process.env.KAIRO_EMBEDDING_PACK_FORMAT ?? "").trim().toLowerCase();
    const format: EmbeddingPackFormat = rawFormat === "q8" ? "q8" : (rawFormat === "both" ? "both" : "float32");
    const enabled = rawFormat.length > 0;

    const rebuildRaw = (process.env.KAIRO_EMBEDDING_PACK_REBUILD ?? "auto").trim().toLowerCase();
    const rebuild = rebuildRaw === "on_start" ? "on_start" : (rebuildRaw === "manual" ? "manual" : "auto");

    const indexRaw = (process.env.KAIRO_EMBEDDING_PACK_INDEX ?? "json").trim().toLowerCase();
    const index = indexRaw === "bin" ? "bin" : "json";

    const cacheMbRaw = (process.env.KAIRO_VECTOR_CACHE_MB ?? "128").trim();
    const cacheMb = cacheMbRaw.length > 0 ? Number.parseInt(cacheMbRaw, 10) : 128;
    const cacheBytes = Number.isFinite(cacheMb) && cacheMb > 0 ? cacheMb * 1024 * 1024 : 128 * 1024 * 1024;

    return { enabled, format, rebuild, index, cacheBytes };
}

export { resolveEmbeddingPackDir };
export { quantizeQ8, dequantizeQ8 };

export class EmbeddingPackManager {
    private readonly key: EmbeddingKey;
    private readonly config: EmbeddingPackConfig;
    private readonly paths: PackPaths;
    private meta: EmbeddingPackMeta | null = null;
    private index: EmbeddingPackIndexV1 | null = null;
    private tombstones: Set<string> | null = null;
    private f32Fd: number | null = null;
    private q8Fd: number | null = null;
    private f32Size = 0;
    private q8Size = 0;
    private dirtyIndex = false;
    private dirtyMeta = false;
    private flushTimer: NodeJS.Timeout | null = null;

    private readonly cache: LRUCache<string, StoredEmbedding>;

    constructor(key: EmbeddingKey, config: EmbeddingPackConfig) {
        this.key = key;
        this.config = config;
        this.paths = getPackPaths(key);
        this.cache = new LRUCache<string, StoredEmbedding>({
            maxSize: config.cacheBytes,
            sizeCalculation: (value) => value.vector.byteLength + 256
        });
    }

    public isEnabled(): boolean {
        return this.config.enabled;
    }

    public hasPackOnDisk(): boolean {
        return fs.existsSync(this.paths.metaPath) && (fs.existsSync(this.paths.f32Path) || fs.existsSync(this.paths.q8Path));
    }

    public isReadyOnDisk(): boolean {
        return fs.existsSync(this.paths.readyPath);
    }

    public markReady(): void {
        if (this.isReadyOnDisk()) return;
        writeJsonAtomic(this.paths.readyPath, { readyAt: new Date().toISOString(), version: 1 });
    }

    public ensureLoaded(dimsHint?: number): void {
        if (!this.config.enabled) return;
        fs.mkdirSync(this.paths.dir, { recursive: true });

        if (!this.meta) {
            const meta = readJson<EmbeddingPackMeta | null>(this.paths.metaPath, null);
            if (meta && meta.version === 1 && meta.provider === this.key.provider && meta.model === this.key.model) {
                this.meta = meta;
            } else if (dimsHint && dimsHint > 0) {
                const now = new Date().toISOString();
                this.meta = {
                    version: 1,
                    provider: this.key.provider,
                    model: this.key.model,
                    dims: dimsHint,
                    format: this.config.format,
                    count: 0,
                    createdAt: now,
                    updatedAt: now
                };
                this.dirtyMeta = true;
            }
        }

        if (!this.index) {
            const loaded = loadIndexFromDisk({
                config: this.config,
                meta: this.meta,
                key: this.key,
                paths: this.paths,
                dimsHint
            });
            if (loaded) {
                this.index = loaded;
            } else {
                this.index = {
                    version: 1,
                    provider: this.key.provider,
                    model: this.key.model,
                    dims: this.meta?.dims ?? (dimsHint ?? 0),
                    format: this.config.format,
                    f32: this.config.format === "q8" ? undefined : {},
                    q8: this.config.format === "float32" ? undefined : {}
                };
                this.dirtyIndex = true;
            }
        }

        if (!this.tombstones) {
            const list = readJson<string[]>(this.paths.tombstonesPath, []);
            this.tombstones = new Set(list.filter(Boolean));
        }

        if (this.f32Fd === null && this.config.format !== "q8") {
            this.f32Fd = fs.openSync(this.paths.f32Path, "a+");
            this.f32Size = fs.existsSync(this.paths.f32Path) ? fs.statSync(this.paths.f32Path).size : 0;
        }
        if (this.q8Fd === null && this.config.format !== "float32") {
            this.q8Fd = fs.openSync(this.paths.q8Path, "a+");
            this.q8Size = fs.existsSync(this.paths.q8Path) ? fs.statSync(this.paths.q8Path).size : 0;
        }
    }

    public upsertEmbedding(chunkId: string, embedding: { dims: number; vector: Float32Array; norm?: number }): void {
        if (!this.config.enabled) return;
        this.ensureLoaded(embedding.dims);
        if (!this.meta || !this.index) return;
        if (this.meta.dims && embedding.dims !== this.meta.dims) {
            return;
        }

        const now = new Date().toISOString();
        this.meta.updatedAt = now;
        this.dirtyMeta = true;

        const idBuf = Buffer.from(chunkId, "utf8");
        this.tombstones?.delete(chunkId);

        if (this.config.format !== "q8") {
            const fd = this.f32Fd;
            if (fd === null) throw new Error("f32 pack not open");
            const recordSize = 4 + idBuf.length + 4 + (this.meta.dims * 4);
            const buf = Buffer.allocUnsafe(recordSize);
            let off = 0;
            buf.writeUInt32LE(idBuf.length, off); off += 4;
            idBuf.copy(buf, off); off += idBuf.length;
            buf.writeFloatLE(embedding.norm ?? 0, off); off += 4;
            const vecBytes = Buffer.from(embedding.vector.buffer, embedding.vector.byteOffset, embedding.vector.byteLength);
            vecBytes.copy(buf, off); off += vecBytes.length;
            const offset = this.f32Size;
            fs.writeSync(fd, buf);
            this.f32Size += buf.length;
            if (!this.index.f32) this.index.f32 = {};
            this.index.f32[chunkId] = offset;
            this.dirtyIndex = true;
        }

        if (this.config.format !== "float32") {
            const fd = this.q8Fd;
            if (fd === null) throw new Error("q8 pack not open");
            const { q, scale } = quantizeQ8(embedding.vector);
            const recordSize = 4 + idBuf.length + 4 + this.meta.dims;
            const buf = Buffer.allocUnsafe(recordSize);
            let off = 0;
            buf.writeUInt32LE(idBuf.length, off); off += 4;
            idBuf.copy(buf, off); off += idBuf.length;
            buf.writeFloatLE(scale, off); off += 4;
            const qBuf = Buffer.from(q.buffer, q.byteOffset, q.byteLength);
            qBuf.copy(buf, off); off += qBuf.length;
            const offset = this.q8Size;
            fs.writeSync(fd, buf);
            this.q8Size += buf.length;
            if (!this.index.q8) this.index.q8 = {};
            this.index.q8[chunkId] = offset;
            this.dirtyIndex = true;
        }

        this.cache.delete(chunkId);
        this.scheduleFlush();
    }

    public deleteEmbedding(chunkId: string): void {
        if (!this.config.enabled) return;
        this.ensureLoaded();
        if (!this.index || !this.tombstones) return;
        this.tombstones.add(chunkId);
        if (this.index.f32) delete this.index.f32[chunkId];
        if (this.index.q8) delete this.index.q8[chunkId];
        this.dirtyIndex = true;
        this.cache.delete(chunkId);
        this.scheduleFlush();
    }

    public getEmbedding(chunkId: string): StoredEmbedding | null {
        if (!this.config.enabled) return null;
        this.ensureLoaded();
        if (this.tombstones?.has(chunkId)) return null;
        const cached = this.cache.get(chunkId);
        if (cached) return { ...cached, vector: new Float32Array(cached.vector) };
        if (!this.meta || !this.index) return null;

        const prefersF32 = this.config.format !== "q8";
        const result = prefersF32
            ? (readF32Embedding({
                chunkId,
                key: this.key,
                meta: this.meta,
                index: this.index,
                f32Fd: this.f32Fd,
                paths: this.paths
            }) ?? readQ8Embedding({
                chunkId,
                key: this.key,
                meta: this.meta,
                index: this.index,
                q8Fd: this.q8Fd,
                paths: this.paths
            }))
            : (readQ8Embedding({
                chunkId,
                key: this.key,
                meta: this.meta,
                index: this.index,
                q8Fd: this.q8Fd,
                paths: this.paths
            }) ?? readF32Embedding({
                chunkId,
                key: this.key,
                meta: this.meta,
                index: this.index,
                f32Fd: this.f32Fd,
                paths: this.paths
            }));

        if (!result) return null;
        this.cache.set(chunkId, result);
        return { ...result, vector: new Float32Array(result.vector) };
    }

    public listEmbeddings(limit?: number): StoredEmbedding[] {
        if (!this.config.enabled) return [];
        this.ensureLoaded();
        if (!this.meta || !this.index) return [];
        const max = Number.isFinite(limit) && (limit as number) > 0 ? Math.floor(limit as number) : undefined;
        const results: StoredEmbedding[] = [];
        const preferF32 = this.config.format !== "q8";
        const map = preferF32 ? (this.index.f32 ?? {}) : (this.index.q8 ?? {});
        for (const chunkId of Object.keys(map)) {
            if (this.tombstones?.has(chunkId)) continue;
            const embedding = this.getEmbedding(chunkId);
            if (!embedding) continue;
            results.push(embedding);
            if (max && results.length >= max) break;
        }
        return results;
    }

    public iterateEmbeddings(
        visitor: (embedding: StoredEmbedding) => void,
        options?: { limit?: number }
    ): void {
        if (!this.config.enabled) return;
        this.ensureLoaded();
        if (!this.meta) return;
        const limit = options?.limit && options.limit > 0 ? Math.floor(options.limit) : undefined;
        const preferF32 = this.config.format !== "q8";
        if (preferF32 && fs.existsSync(this.paths.f32Path)) {
            scanF32({
                key: this.key,
                meta: this.meta,
                tombstones: this.tombstones,
                paths: this.paths,
                visitor,
                limit
            });
            return;
        }
        if (fs.existsSync(this.paths.q8Path)) {
            scanQ8({
                key: this.key,
                meta: this.meta,
                tombstones: this.tombstones,
                paths: this.paths,
                visitor,
                limit
            });
        }
    }

    public flush(): void {
        if (!this.config.enabled) return;
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.meta && this.index) {
            const count = this.index.f32
                ? Object.keys(this.index.f32).length
                : (this.index.q8 ? Object.keys(this.index.q8).length : 0);
            this.meta.count = count;
        }
        if (this.dirtyIndex && this.index) {
            if (this.config.index === "bin") {
                writeIndexBin({ indexBinPath: this.paths.indexBinPath, index: this.index });
            } else {
                writeJsonAtomic(this.paths.indexPath, this.index);
            }
            this.dirtyIndex = false;
        }
        if (this.tombstones) {
            writeJsonAtomic(this.paths.tombstonesPath, Array.from(this.tombstones));
        }
        if (this.dirtyMeta && this.meta) {
            writeJsonAtomic(this.paths.metaPath, this.meta);
            this.dirtyMeta = false;
        }
    }

    public close(): void {
        this.flush();
        if (this.f32Fd !== null) {
            try { fs.closeSync(this.f32Fd); } catch { /* ignore */ }
            this.f32Fd = null;
        }
        if (this.q8Fd !== null) {
            try { fs.closeSync(this.q8Fd); } catch { /* ignore */ }
            this.q8Fd = null;
        }
    }

    private scheduleFlush(): void {
        if (this.flushTimer) return;
        this.flushTimer = setTimeout(() => {
            this.flush();
        }, 500);
    }

}
