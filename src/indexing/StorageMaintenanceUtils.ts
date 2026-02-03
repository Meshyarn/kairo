import type { StoredEvidencePack } from "./EvidencePackRepository.js";
import type { IndexDatabase } from "./IndexDatabase.js";
import * as fs from "fs";
import * as path from "path";

export async function collectTempEntries(basePath: string): Promise<Array<{ filePath: string; size: number; mtimeMs: number }>> {
    const entries: Array<{ filePath: string; size: number; mtimeMs: number }> = [];
    let stats: fs.Stats | undefined;
    try {
        stats = await fs.promises.stat(basePath);
    } catch {
        return entries;
    }
    if (!stats.isDirectory()) return entries;

    const stack = [basePath];
    while (stack.length > 0) {
        const current = stack.pop()!;
        let dirEntries: fs.Dirent[] = [];
        try {
            dirEntries = await fs.promises.readdir(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of dirEntries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (entry.isSymbolicLink()) {
                continue;
            }
            if (entry.isFile()) {
                try {
                    const fileStat = await fs.promises.stat(fullPath);
                    entries.push({
                        filePath: fullPath,
                        size: fileStat.size,
                        mtimeMs: fileStat.mtimeMs
                    });
                } catch {
                    continue;
                }
            }
        }
    }
    return entries;
}

export async function cleanupEmptyDirs(basePath: string): Promise<void> {
    const dirStat = await fs.promises.stat(basePath).catch(() => null);
    if (!dirStat || !dirStat.isDirectory()) return;
    const entries = await fs.promises.readdir(basePath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const fullPath = path.join(basePath, entry.name);
        await cleanupEmptyDirs(fullPath);
    }
    const remaining = await fs.promises.readdir(basePath).catch(() => []);
    if (remaining.length === 0) {
        await fs.promises.rmdir(basePath).catch(() => undefined);
    }
}

export function resolveLimit(explicit: number | undefined, envKey: string, fallback: number): number {
    if (Number.isFinite(explicit)) {
        return Math.max(0, Math.floor(explicit as number));
    }
    const raw = process.env[envKey];
    const parsed = Number.parseInt(raw ?? "", 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
    }
    return fallback;
}

export function estimateBytes(payload: unknown): number {
    try {
        return Buffer.byteLength(JSON.stringify(payload ?? {}), "utf8");
    } catch {
        return 0;
    }
}

export function coerceEvidencePack(payload: unknown): StoredEvidencePack | null {
    if (!payload || typeof payload !== "object") return null;
    const pack = payload as StoredEvidencePack;
    if (!Array.isArray(pack.items)) return null;
    return pack;
}

export function isPackStale(indexDb: IndexDatabase, pack: StoredEvidencePack, maxItems: number): boolean {
    const items = Array.isArray(pack.items) ? pack.items : [];
    const slice = items.slice(0, Math.max(1, maxItems));
    for (const item of slice) {
        const snapshotHash = item.snapshot?.contentHash;
        if (!snapshotHash) continue;
        const currentHash = indexDb.getChunkContentHash(item.chunkId);
        if (!currentHash || currentHash !== snapshotHash) {
            return true;
        }
    }
    return false;
}

export function isSummaryStale(
    contentHash: string,
    styles: Record<"preview" | "summary", { summary: string; contentHash?: string }>
): boolean {
    for (const entry of Object.values(styles)) {
        if (!entry) return true;
        if (!entry.contentHash) {
            return true;
        }
        if (contentHash && entry.contentHash !== contentHash) {
            return true;
        }
    }
    return false;
}

export function applyCap<T>(
    entries: T[],
    maxCount: number,
    sortKey: (entry: T) => number,
    idKey: (entry: T) => string,
    deletedIds: Set<string>,
    deleteReason: (reason: string) => void,
    reason: string
): T[] {
    const sorted = [...entries].sort((a, b) => sortKey(a) - sortKey(b));
    const over = Math.max(0, sorted.length - maxCount);
    for (let i = 0; i < over; i += 1) {
        const id = idKey(sorted[i]);
        deletedIds.add(id);
        deleteReason(reason);
    }
    return entries.filter(entry => !deletedIds.has(idKey(entry)));
}
