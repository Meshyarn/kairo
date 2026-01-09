import path from "path";
import { promises as fs } from "fs";
import { LRUCache } from "lru-cache";
import type { ArtifactId, ArtifactManagerStatus, ArtifactType, FlowArtifact } from "../types/flow-artifacts.js";

export interface FlowArtifactManagerOptions {
    maxCacheSize?: number;
    defaultTTL?: number;
    persistPath?: string;
    autoPersist?: boolean;
}

export class FlowArtifactManager {
    private readonly cache: LRUCache<ArtifactId, FlowArtifact>;
    private readonly persistPath: string;

    constructor(private readonly options: FlowArtifactManagerOptions = {}) {
        this.cache = new LRUCache({
            max: options.maxCacheSize ?? 100,
            ttl: options.defaultTTL ?? 30 * 60 * 1000
        });
        this.persistPath = options.persistPath ?? path.resolve(process.cwd(), ".kairo", "flow-artifacts");
    }

    store<T extends FlowArtifact>(artifact: T): ArtifactId {
        this.cache.set(artifact.id, artifact);
        if (this.options.autoPersist) {
            void this.persist(artifact.id, artifact);
        }
        return artifact.id;
    }

    get<T extends FlowArtifact>(id: ArtifactId): T | undefined {
        return this.cache.get(id) as T | undefined;
    }

    getByType<T extends FlowArtifact>(type: ArtifactType): T[] {
        return Array.from(this.cache.values()).filter((artifact) => artifact.type === type) as T[];
    }

    getRecent(limit: number = 10): FlowArtifact[] {
        return Array.from(this.cache.values())
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, limit);
    }

    getBySession(sessionId: string): FlowArtifact[] {
        return Array.from(this.cache.values())
            .filter((artifact) => artifact.sessionId === sessionId);
    }

    discard(id: ArtifactId): boolean {
        const existed = this.cache.has(id);
        this.cache.delete(id);
        void this.removePersisted(id);
        return existed;
    }

    prune(): number {
        const before = this.cache.size;
        this.cache.purgeStale();
        return before - this.cache.size;
    }

    status(): ArtifactManagerStatus {
        const artifacts = Array.from(this.cache.values());
        return {
            totalCount: artifacts.length,
            byType: this.countByType(artifacts),
            oldestAt: artifacts.length > 0 ? Math.min(...artifacts.map((a) => a.createdAt)) : 0,
            newestAt: artifacts.length > 0 ? Math.max(...artifacts.map((a) => a.createdAt)) : 0,
            cacheUtilization: artifacts.length / (this.options.maxCacheSize ?? 100)
        };
    }

    async persist(id: ArtifactId, artifact: FlowArtifact): Promise<string> {
        const target = await this.resolvePersistPath(id, artifact.type, true);
        await fs.writeFile(target, JSON.stringify(artifact, null, 2), "utf-8");
        return target;
    }

    async restore(id: ArtifactId): Promise<FlowArtifact | undefined> {
        try {
            const filePath = await this.resolvePersistPath(id);
            const raw = await fs.readFile(filePath, "utf-8");
            const artifact = JSON.parse(raw) as FlowArtifact;
            this.cache.set(artifact.id, artifact);
            return artifact;
        } catch {
            return undefined;
        }
    }

    async importFromPath(filePath: string): Promise<FlowArtifact | undefined> {
        try {
            const raw = await fs.readFile(filePath, "utf-8");
            const artifact = JSON.parse(raw) as FlowArtifact;
            this.cache.set(artifact.id, artifact);
            return artifact;
        } catch {
            return undefined;
        }
    }

    async restoreAll(): Promise<number> {
        try {
            const entries = await fs.readdir(this.persistPath);
            let restored = 0;
            for (const entry of entries) {
                if (!entry.endsWith(".json")) continue;
                const full = path.join(this.persistPath, entry);
                const artifact = await this.importFromPath(full);
                if (artifact) restored += 1;
            }
            return restored;
        } catch {
            return 0;
        }
    }

    private async removePersisted(id: ArtifactId): Promise<void> {
        try {
            const filePath = await this.resolvePersistPath(id);
            await fs.rm(filePath, { force: true });
        } catch {
            // ignore
        }
    }

    private async resolvePersistPath(id: ArtifactId, type?: ArtifactType, ensureDir?: boolean): Promise<string> {
        const folder = type ? `${type}s` : "";
        const basePath = folder ? path.join(this.persistPath, folder) : this.persistPath;
        if (ensureDir) {
            await fs.mkdir(basePath, { recursive: true });
        }
        const candidate = path.join(basePath, `${id}.json`);
        if (type || ensureDir) {
            return candidate;
        }
        const types: ArtifactType[] = ["research", "analysis", "style", "draft", "review"];
        for (const entryType of types) {
            const entryPath = path.join(this.persistPath, `${entryType}s`, `${id}.json`);
            try {
                await fs.access(entryPath);
                return entryPath;
            } catch {
                // continue
            }
        }
        return candidate;
    }

    private countByType(artifacts: FlowArtifact[]): Record<ArtifactType, number> {
        return artifacts.reduce((acc, artifact) => {
            acc[artifact.type] = (acc[artifact.type] ?? 0) + 1;
            return acc;
        }, {} as Record<ArtifactType, number>);
    }
}
