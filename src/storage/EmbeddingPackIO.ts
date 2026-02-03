import * as fs from "fs";
import * as path from "path";
import type { EmbeddingKey, StoredEmbedding } from "./IndexStore.js";
import type { EmbeddingPackConfig, EmbeddingPackIndexV1, EmbeddingPackMeta } from "./EmbeddingPack.js";
import type { PackPaths } from "./EmbeddingPackPaths.js";
import { dequantizeQ8 } from "./EmbeddingPackQuantize.js";

export const readJson = <T>(filePath: string, fallback: T): T => {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const raw = fs.readFileSync(filePath, "utf8");
        if (!raw.trim()) return fallback;
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
};

export const writeJsonAtomic = (filePath: string, value: unknown): void => {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(value));
    fs.renameSync(tmpPath, filePath);
};

export const loadIndexFromDisk = (args: {
    config: EmbeddingPackConfig;
    meta: EmbeddingPackMeta | null;
    key: EmbeddingKey;
    paths: PackPaths;
    dimsHint?: number;
}): EmbeddingPackIndexV1 | null => {
    const dims = args.meta?.dims ?? args.dimsHint ?? 0;
    if (args.config.index === "bin") {
        const binIndex = readIndexBin({ indexBinPath: args.paths.indexBinPath, key: args.key, dims });
        if (binIndex) return binIndex;
    }
    const index = readJson<EmbeddingPackIndexV1 | null>(args.paths.indexPath, null);
    if (index && index.version === 1 && index.provider === args.key.provider && index.model === args.key.model) {
        return index;
    }
    return null;
};

export const readIndexBin = (args: {
    indexBinPath: string;
    key: EmbeddingKey;
    dims: number;
}): EmbeddingPackIndexV1 | null => {
    if (!fs.existsSync(args.indexBinPath)) return null;
    try {
        const raw = fs.readFileSync(args.indexBinPath);
        if (raw.length < 16) return null;
        const magic = raw.subarray(0, 4).toString("ascii");
        if (magic !== "SCIX") return null;
        const version = raw.readUInt32LE(4);
        if (version !== 1) return null;
        const flags = raw.readUInt32LE(8);
        const recordCount = raw.readUInt32LE(12);
        const index: EmbeddingPackIndexV1 = {
            version: 1,
            provider: args.key.provider,
            model: args.key.model,
            dims: args.dims,
            format: flags === 3 ? "both" : (flags === 2 ? "q8" : "float32"),
            f32: (flags & 1) ? {} : undefined,
            q8: (flags & 2) ? {} : undefined
        };
        let offset = 16;
        for (let i = 0; i < recordCount; i += 1) {
            if (offset + 4 > raw.length) break;
            const keyLen = raw.readUInt32LE(offset);
            offset += 4;
            if (offset + keyLen + 12 > raw.length) break;
            const key = raw.subarray(offset, offset + keyLen).toString("utf8");
            offset += keyLen;
            const kind = raw.readUInt8(offset);
            offset += 1;
            offset += 1;
            offset += 2;
            const off64 = raw.readBigUInt64LE(offset);
            offset += 8;
            if (off64 > BigInt(Number.MAX_SAFE_INTEGER)) {
                continue;
            }
            const offNum = Number(off64);
            if (kind === 0) {
                if (!index.f32) index.f32 = {};
                index.f32[key] = offNum;
            } else if (kind === 1) {
                if (!index.q8) index.q8 = {};
                index.q8[key] = offNum;
            }
        }
        return index;
    } catch {
        return null;
    }
};

export const writeIndexBin = (args: { indexBinPath: string; index: EmbeddingPackIndexV1 }): void => {
    const dir = path.dirname(args.indexBinPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${args.indexBinPath}.tmp-${process.pid}-${Date.now()}`;
    const fd = fs.openSync(tmpPath, "w");
    try {
        const formatFlags = args.index.format === "both" ? 3 : (args.index.format === "q8" ? 2 : 1);
        const f32Keys = args.index.f32 ? Object.keys(args.index.f32) : [];
        const q8Keys = args.index.q8 ? Object.keys(args.index.q8) : [];
        const recordCount = f32Keys.length + q8Keys.length;
        const header = Buffer.allocUnsafe(16);
        header.write("SCIX", 0, "ascii");
        header.writeUInt32LE(1, 4);
        header.writeUInt32LE(formatFlags, 8);
        header.writeUInt32LE(recordCount, 12);
        fs.writeSync(fd, header);

        const writeRecord = (key: string, kind: number, offsetValue: number) => {
            const keyBuf = Buffer.from(key, "utf8");
            const buf = Buffer.allocUnsafe(4 + keyBuf.length + 1 + 1 + 2 + 8);
            let off = 0;
            buf.writeUInt32LE(keyBuf.length, off); off += 4;
            keyBuf.copy(buf, off); off += keyBuf.length;
            buf.writeUInt8(kind, off); off += 1;
            buf.writeUInt8(0, off); off += 1;
            buf.writeUInt16LE(0, off); off += 2;
            const offset64 = BigInt(Math.max(0, Math.floor(offsetValue)));
            buf.writeBigUInt64LE(offset64, off);
            fs.writeSync(fd, buf);
        };

        for (const key of f32Keys) {
            const offsetValue = args.index.f32?.[key];
            if (typeof offsetValue !== "number") continue;
            writeRecord(key, 0, offsetValue);
        }
        for (const key of q8Keys) {
            const offsetValue = args.index.q8?.[key];
            if (typeof offsetValue !== "number") continue;
            writeRecord(key, 1, offsetValue);
        }
    } finally {
        try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    fs.renameSync(tmpPath, args.indexBinPath);
};

export const readF32Embedding = (args: {
    chunkId: string;
    key: EmbeddingKey;
    meta: EmbeddingPackMeta | null;
    index: EmbeddingPackIndexV1 | null;
    f32Fd: number | null;
    paths: PackPaths;
}): StoredEmbedding | null => {
    if (!args.meta || !args.index?.f32) return null;
    const offset = args.index.f32[args.chunkId];
    if (!Number.isFinite(offset)) return null;
    const fd = args.f32Fd ?? fs.openSync(args.paths.f32Path, "r");
    const idLenBuf = Buffer.allocUnsafe(4);
    fs.readSync(fd, idLenBuf, 0, 4, offset);
    const idLen = idLenBuf.readUInt32LE(0);
    const idBuf = Buffer.allocUnsafe(idLen);
    fs.readSync(fd, idBuf, 0, idLen, offset + 4);
    const normBuf = Buffer.allocUnsafe(4);
    fs.readSync(fd, normBuf, 0, 4, offset + 4 + idLen);
    const norm = normBuf.readFloatLE(0);
    const vecBuf = Buffer.allocUnsafe(args.meta.dims * 4);
    fs.readSync(fd, vecBuf, 0, vecBuf.length, offset + 4 + idLen + 4);
    const vector = new Float32Array(vecBuf.buffer, vecBuf.byteOffset, args.meta.dims);
    return {
        chunkId: args.chunkId,
        provider: args.key.provider,
        model: args.key.model,
        dims: args.meta.dims,
        vector: new Float32Array(vector),
        norm: norm || undefined
    };
};

export const readQ8Embedding = (args: {
    chunkId: string;
    key: EmbeddingKey;
    meta: EmbeddingPackMeta | null;
    index: EmbeddingPackIndexV1 | null;
    q8Fd: number | null;
    paths: PackPaths;
}): StoredEmbedding | null => {
    if (!args.meta || !args.index?.q8) return null;
    const offset = args.index.q8[args.chunkId];
    if (!Number.isFinite(offset)) return null;
    const fd = args.q8Fd ?? fs.openSync(args.paths.q8Path, "r");
    const idLenBuf = Buffer.allocUnsafe(4);
    fs.readSync(fd, idLenBuf, 0, 4, offset);
    const idLen = idLenBuf.readUInt32LE(0);
    const idBuf = Buffer.allocUnsafe(idLen);
    fs.readSync(fd, idBuf, 0, idLen, offset + 4);
    const scaleBuf = Buffer.allocUnsafe(4);
    fs.readSync(fd, scaleBuf, 0, 4, offset + 4 + idLen);
    const scale = scaleBuf.readFloatLE(0);
    const qBuf = Buffer.allocUnsafe(args.meta.dims);
    fs.readSync(fd, qBuf, 0, qBuf.length, offset + 4 + idLen + 4);
    const q = new Int8Array(qBuf.buffer, qBuf.byteOffset, args.meta.dims);
    const vector = dequantizeQ8(q, scale);
    return {
        chunkId: args.chunkId,
        provider: args.key.provider,
        model: args.key.model,
        dims: args.meta.dims,
        vector
    };
};

export const scanF32 = (args: {
    key: EmbeddingKey;
    meta: EmbeddingPackMeta | null;
    tombstones: Set<string> | null;
    paths: PackPaths;
    visitor: (embedding: StoredEmbedding) => void;
    limit?: number;
}): void => {
    if (!args.meta) return;
    if (!fs.existsSync(args.paths.f32Path)) return;
    const fd = fs.openSync(args.paths.f32Path, "r");
    try {
        const size = fs.statSync(args.paths.f32Path).size;
        let offset = 0;
        let count = 0;
        const idLenBuf = Buffer.allocUnsafe(4);
        const normBuf = Buffer.allocUnsafe(4);
        while (offset < size) {
            if (args.limit && count >= args.limit) break;
            fs.readSync(fd, idLenBuf, 0, 4, offset);
            const idLen = idLenBuf.readUInt32LE(0);
            const idBuf = Buffer.allocUnsafe(idLen);
            fs.readSync(fd, idBuf, 0, idLen, offset + 4);
            const chunkId = idBuf.toString("utf8");
            if (args.tombstones?.has(chunkId)) {
                offset += 4 + idLen + 4 + (args.meta.dims * 4);
                continue;
            }
            fs.readSync(fd, normBuf, 0, 4, offset + 4 + idLen);
            const norm = normBuf.readFloatLE(0);
            const vecBuf = Buffer.allocUnsafe(args.meta.dims * 4);
            fs.readSync(fd, vecBuf, 0, vecBuf.length, offset + 4 + idLen + 4);
            const vector = new Float32Array(vecBuf.buffer, vecBuf.byteOffset, args.meta.dims);
            args.visitor({
                chunkId,
                provider: args.key.provider,
                model: args.key.model,
                dims: args.meta.dims,
                vector: new Float32Array(vector),
                norm: norm || undefined
            });
            offset += 4 + idLen + 4 + vecBuf.length;
            count++;
        }
    } finally {
        try { fs.closeSync(fd); } catch { /* ignore */ }
    }
};

export const scanQ8 = (args: {
    key: EmbeddingKey;
    meta: EmbeddingPackMeta | null;
    tombstones: Set<string> | null;
    paths: PackPaths;
    visitor: (embedding: StoredEmbedding) => void;
    limit?: number;
}): void => {
    if (!args.meta) return;
    if (!fs.existsSync(args.paths.q8Path)) return;
    const fd = fs.openSync(args.paths.q8Path, "r");
    try {
        const size = fs.statSync(args.paths.q8Path).size;
        let offset = 0;
        let count = 0;
        const idLenBuf = Buffer.allocUnsafe(4);
        const scaleBuf = Buffer.allocUnsafe(4);
        while (offset < size) {
            if (args.limit && count >= args.limit) break;
            fs.readSync(fd, idLenBuf, 0, 4, offset);
            const idLen = idLenBuf.readUInt32LE(0);
            const idBuf = Buffer.allocUnsafe(idLen);
            fs.readSync(fd, idBuf, 0, idLen, offset + 4);
            const chunkId = idBuf.toString("utf8");
            if (args.tombstones?.has(chunkId)) {
                offset += 4 + idLen + 4 + args.meta.dims;
                continue;
            }
            fs.readSync(fd, scaleBuf, 0, 4, offset + 4 + idLen);
            const scale = scaleBuf.readFloatLE(0);
            const qBuf = Buffer.allocUnsafe(args.meta.dims);
            fs.readSync(fd, qBuf, 0, qBuf.length, offset + 4 + idLen + 4);
            const q = new Int8Array(qBuf.buffer, qBuf.byteOffset, args.meta.dims);
            args.visitor({
                chunkId,
                provider: args.key.provider,
                model: args.key.model,
                dims: args.meta.dims,
                vector: dequantizeQ8(q, scale)
            });
            offset += 4 + idLen + 4 + qBuf.length;
            count++;
        }
    } finally {
        try { fs.closeSync(fd); } catch { /* ignore */ }
    }
};
