import path from "path";
import { promises as fs } from "fs";
import { LRUCache } from "lru-cache";
import type {
    ArtifactId,
    ArtifactManagerStatus,
    ArtifactType,
    FlowArtifact,
    FlowSession,
    FlowSessionOutcome
} from "../types/flow-artifacts.js";

export interface FlowArtifactManagerOptions {
    maxCacheSize?: number;
    defaultTTL?: number;
    persistPath?: string;
    autoPersist?: boolean;
}

export class FlowArtifactManager {
    private readonly cache: LRUCache<ArtifactId, FlowArtifact>;
    private readonly persistPath: string;
    private readonly sessions: Map<string, FlowSession>;

    constructor(private readonly options: FlowArtifactManagerOptions = {}) {
        this.cache = new LRUCache({
            max: options.maxCacheSize ?? 100,
            ttl: options.defaultTTL ?? 30 * 60 * 1000
        });
        this.persistPath = options.persistPath ?? path.resolve(process.cwd(), ".kairo", "flow-artifacts");
        this.sessions = new Map<string, FlowSession>();
    }

    store<T extends FlowArtifact>(artifact: T): ArtifactId {
        this.cache.set(artifact.id, artifact);
        if (artifact.sessionId) {
            this.attachToSession(artifact.sessionId, artifact, artifact.metadata?.intent as string | undefined);
        }
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

    resolveSessionId(rawSessionId: string | undefined, intent: string): string | undefined {
        if (!rawSessionId) {
            return undefined;
        }
        if (rawSessionId === "new") {
            const session = this.createSession(intent);
            return session.id;
        }
        if (!this.sessions.has(rawSessionId)) {
            this.createSession(intent, rawSessionId);
        }
        return rawSessionId;
    }

    getSession(sessionId: string): FlowSession | undefined {
        return this.sessions.get(sessionId);
    }

    listSessions(limit: number = 10): FlowSession[] {
        return Array.from(this.sessions.values())
            .sort((a, b) => (b.updatedAt ?? b.startedAt) - (a.updatedAt ?? a.startedAt))
            .slice(0, limit);
    }

    completeSession(sessionId: string, outcome?: FlowSessionOutcome): FlowSession | undefined {
        const session = this.sessions.get(sessionId);
        if (!session) return undefined;
        session.status = "completed";
        session.outcome = outcome;
        session.updatedAt = Date.now();
        if (this.options.autoPersist) {
            void this.persistSession(session);
        }
        return session;
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

    async persistSession(session: FlowSession): Promise<string> {
        const sessionDir = path.join(this.persistPath, "sessions");
        await fs.mkdir(sessionDir, { recursive: true });
        const target = path.join(sessionDir, `${session.id}.json`);
        await fs.writeFile(target, JSON.stringify(session, null, 2), "utf-8");
        return target;
    }

    async restoreSession(sessionId: string): Promise<FlowSession | undefined> {
        try {
            const sessionDir = path.join(this.persistPath, "sessions");
            const filePath = path.join(sessionDir, `${sessionId}.json`);
            const raw = await fs.readFile(filePath, "utf-8");
            const session = JSON.parse(raw) as FlowSession;
            this.sessions.set(session.id, session);
            return session;
        } catch {
            return undefined;
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

    private createSession(intent: string, sessionId?: string): FlowSession {
        const session: FlowSession = {
            id: sessionId ?? this.generateSessionId(),
            startedAt: Date.now(),
            intent,
            status: "active",
            artifacts: {
                drafts: [],
                reviews: []
            }
        };
        this.sessions.set(session.id, session);
        if (this.options.autoPersist) {
            void this.persistSession(session);
        }
        return session;
    }

    private attachToSession(sessionId: string, artifact: FlowArtifact, intent?: string): void {
        const session = this.sessions.get(sessionId) ?? this.createSession(intent ?? "session");
        switch (artifact.type) {
            case "research":
                session.artifacts.research = artifact.pack.id;
                break;
            case "analysis":
                session.artifacts.analysis = artifact.pack.id;
                break;
            case "style":
                session.artifacts.style = artifact.pack.id;
                break;
            case "draft":
                session.artifacts.drafts.push(artifact.pack.id);
                break;
            case "review":
                session.artifacts.reviews.push(artifact.report.id);
                break;
            default:
                break;
        }
        session.updatedAt = Date.now();
        if (this.options.autoPersist) {
            void this.persistSession(session);
        }
    }

    private generateSessionId(): string {
        const suffix = Math.random().toString(36).slice(2, 8);
        return `session_${Date.now().toString(36)}_${suffix}`;
    }
}
