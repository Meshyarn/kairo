import path from "path";
import { LRUCache } from "lru-cache";
import { NodeFileSystem, type IFileSystem } from "../platform/FileSystem.js";
import type {
    ArtifactId,
    ArtifactManagerStatus,
    ArtifactType,
    FlowArtifact,
    FlowSession,
    FlowSessionOutcome,
    FlowSessionStatus,
    SessionPolicy,
    StylePack,
    AnalysisPack
} from "../types/flow-artifacts.js";

export interface FlowArtifactManagerOptions {
    maxCacheSize?: number;
    defaultTTL?: number;
    persistPath?: string;
    autoPersist?: boolean;
    fileSystem?: IFileSystem;
}

interface FlowArtifactIndexEntry {
    type: ArtifactType;
    path?: string;
    sessionId?: string;
    createdAt?: number;
}

interface FlowSessionIndexEntry {
    path?: string;
    status?: FlowSessionStatus;
    updatedAt?: number;
}

interface FlowArtifactIndex {
    version: number;
    updatedAt: number;
    artifacts: Record<string, FlowArtifactIndexEntry>;
    sessions: Record<string, FlowSessionIndexEntry>;
}

export class FlowArtifactManager {
    private readonly cache: LRUCache<ArtifactId, FlowArtifact>;
    private readonly persistPath: string;
    private readonly indexPath: string;
    private readonly sessions: Map<string, FlowSession>;
    private index: FlowArtifactIndex;
    private readonly fileSystem: IFileSystem;

    constructor(private readonly options: FlowArtifactManagerOptions = {}) {
        this.cache = new LRUCache({
            max: options.maxCacheSize ?? 100,
            ttl: options.defaultTTL ?? 30 * 60 * 1000
        });
        this.fileSystem = options.fileSystem ?? new NodeFileSystem(process.cwd());
        this.persistPath = options.persistPath ?? path.resolve(process.cwd(), ".kairo", "flow-artifacts");
        this.indexPath = path.join(this.persistPath, "index.json");
        this.sessions = new Map<string, FlowSession>();
        this.index = {
            version: 1,
            updatedAt: 0,
            artifacts: {},
            sessions: {}
        };
    }

    store<T extends FlowArtifact>(artifact: T): ArtifactId {
        const stored = { ...artifact };
        this.cache.set(stored.id, stored);
        this.updateIndexForArtifact(stored);
        if (stored.sessionId) {
            this.attachToSession(stored.sessionId, stored, stored.metadata?.intent as string | undefined);
        }
        if (this.options.autoPersist) {
            void this.persist(stored.id, stored);
        }
        return stored.id;
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

    getLatestStylePack(sessionId: string): StylePack | undefined {
        const latest = this.getBySession(sessionId)
            .filter((artifact) => artifact.type === "style")
            .sort((a, b) => b.createdAt - a.createdAt)[0];
        return latest && "pack" in latest ? (latest.pack as StylePack) : undefined;
    }

    getLatestAnalysisPack(sessionId: string): AnalysisPack | undefined {
        const latest = this.getBySession(sessionId)
            .filter((artifact) => artifact.type === "analysis")
            .sort((a, b) => b.createdAt - a.createdAt)[0];
        return latest && "pack" in latest ? (latest.pack as AnalysisPack) : undefined;
    }

    getSessionSummary(sessionId: string): { session: FlowSession; summary: { counts: Record<ArtifactType, number>; lastUpdatedAt: number; latestIds: Record<string, string | undefined> } } | undefined {
        const session = this.sessions.get(sessionId);
        if (!session) return undefined;
        const artifacts = this.getBySession(sessionId);
        const rawCounts = this.countByType(artifacts);
        const counts = {
            research: rawCounts.research ?? 0,
            analysis: rawCounts.analysis ?? 0,
            style: rawCounts.style ?? 0,
            draft: rawCounts.draft ?? 0,
            review: rawCounts.review ?? 0
        };
        const lastUpdatedAt = Math.max(
            session.updatedAt ?? session.startedAt,
            ...(artifacts.map((artifact) => artifact.createdAt))
        );
        const latestIds: Record<string, string | undefined> = {
            research: session.artifacts.research,
            analysis: session.artifacts.analysis,
            style: session.artifacts.style,
            draft: session.artifacts.drafts.slice(-1)[0],
            review: session.artifacts.reviews.slice(-1)[0]
        };
        return { session, summary: { counts, lastUpdatedAt, latestIds } };
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
        this.updateIndexForSession(session);
        if (this.options.autoPersist) {
            void this.persistSession(session);
        }
        return session;
    }

    async updateSessionPolicy(
        sessionId: string,
        policy: SessionPolicy | undefined,
        policyMode: "merge" | "replace" = "merge"
    ): Promise<FlowSession | undefined> {
        const session = this.sessions.get(sessionId);
        if (!session) return undefined;
        if (!policy) {
            if (policyMode === "replace") {
                session.policy = undefined;
            }
        } else if (policyMode === "replace") {
            session.policy = { ...policy };
        } else {
            session.policy = this.mergePolicy(session.policy, policy);
        }
        session.updatedAt = Date.now();
        this.updateIndexForSession(session);
        if (this.options.autoPersist) {
            await this.persistSession(session);
        }
        return session;
    }

    discard(id: ArtifactId): boolean {
        const artifact = this.cache.get(id);
        const existed = this.cache.has(id);
        this.cache.delete(id);
        if (artifact?.sessionId) {
            this.detachFromSession(artifact.sessionId, artifact);
        }
        this.removeIndexEntry(id);
        void this.removePersisted(id);
        return existed;
    }

    prune(): number {
        const before = this.cache.size;
        this.cache.purgeStale();
        return before - this.cache.size;
    }

    async prunePersisted(options: { removeOrphans?: boolean } = {}): Promise<{ deletedFiles: number; fixedIndexEntries: number; removedSessions: number }> {
        const removeOrphans = options.removeOrphans !== false;
        const index = await this.readIndex();
        if (!index) {
            return { deletedFiles: 0, fixedIndexEntries: 0, removedSessions: 0 };
        }
        this.index = index;
        let fixedIndexEntries = 0;
        let deletedFiles = 0;
        let removedSessions = 0;
        let updated = false;

        const artifactEntries = Object.entries(this.index.artifacts ?? {});
        for (const [id, entry] of artifactEntries) {
            const absPath = entry.path
                ? this.toAbsolutePersistPath(entry.path)
                : await this.resolvePersistPath(id as ArtifactId, entry.type);
            if (!await this.fileSystem.exists(absPath)) {
                delete this.index.artifacts[id];
                fixedIndexEntries += 1;
                updated = true;
            }
        }

        const sessionEntries = Object.entries(this.index.sessions ?? {});
        for (const [sessionId, entry] of sessionEntries) {
            if (!entry?.path) continue;
            const absPath = this.toAbsolutePersistPath(entry.path);
            if (!await this.fileSystem.exists(absPath)) {
                delete this.index.sessions[sessionId];
                removedSessions += 1;
                updated = true;
            }
        }

        if (removeOrphans) {
            deletedFiles += await this.removeOrphanedArtifacts();
            deletedFiles += await this.removeOrphanedSessions();
        }

        if (updated || deletedFiles > 0) {
            this.touchIndex();
            await this.persistIndex();
        }

        return { deletedFiles, fixedIndexEntries, removedSessions };
    }

    async planPrunePersisted(options: { removeOrphans?: boolean } = {}): Promise<{ deletedFiles: number; fixedIndexEntries: number; removedSessions: number }> {
        const removeOrphans = options.removeOrphans !== false;
        const index = await this.readIndex();
        if (!index) {
            return { deletedFiles: 0, fixedIndexEntries: 0, removedSessions: 0 };
        }

        let fixedIndexEntries = 0;
        let deletedFiles = 0;
        let removedSessions = 0;

        const artifactEntries = Object.entries(index.artifacts ?? {});
        for (const [id, entry] of artifactEntries) {
            const absPath = entry.path
                ? this.toAbsolutePersistPath(entry.path)
                : await this.resolvePersistPath(id as ArtifactId, entry.type);
            if (!await this.fileSystem.exists(absPath)) {
                fixedIndexEntries += 1;
            }
        }

        const sessionEntries = Object.entries(index.sessions ?? {});
        for (const [sessionId, entry] of sessionEntries) {
            if (!entry?.path) continue;
            const absPath = this.toAbsolutePersistPath(entry.path);
            if (!await this.fileSystem.exists(absPath)) {
                removedSessions += 1;
            }
        }

        if (removeOrphans) {
            deletedFiles += await this.countOrphanedArtifacts(index);
            deletedFiles += await this.countOrphanedSessions(index);
        }

        return { deletedFiles, fixedIndexEntries, removedSessions };
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
        await this.fileSystem.writeFile(target, JSON.stringify(artifact, null, 2));
        this.updateIndexForArtifact(artifact, target);
        await this.persistIndex();
        return target;
    }

    async restore(id: ArtifactId): Promise<FlowArtifact | undefined> {
        try {
            const filePath = await this.resolvePersistPath(id);
            const raw = await this.fileSystem.readFile(filePath);
            const artifact = JSON.parse(raw) as FlowArtifact;
            this.store(artifact);
            this.updateIndexForArtifact(artifact, filePath);
            return artifact;
        } catch {
            return undefined;
        }
    }

    async importFromPath(filePath: string): Promise<FlowArtifact | undefined> {
        try {
            const raw = await this.fileSystem.readFile(filePath);
            const artifact = JSON.parse(raw) as FlowArtifact;
            this.store(artifact);
            this.updateIndexForArtifact(artifact, filePath);
            return artifact;
        } catch {
            return undefined;
        }
    }

    async restoreAll(): Promise<number> {
        const restoredFromIndex = await this.restoreFromIndex();
        if (restoredFromIndex >= 0) {
            return restoredFromIndex;
        }
        try {
            const entries = await this.safeReadDirEntries(this.persistPath);
            let restored = 0;
            for (const entry of entries) {
                if (entry.isFile) {
                    if (!entry.name.endsWith(".json")) continue;
                    const full = path.join(this.persistPath, entry.name);
                    const artifact = await this.importFromPath(full);
                    if (artifact) restored += 1;
                    continue;
                }
                if (!entry.isDirectory) continue;
                const fullDir = path.join(this.persistPath, entry.name);
                if (entry.name === "sessions") {
                    await this.restoreSessionsFromDir(fullDir);
                    continue;
                }
                restored += await this.restoreArtifactsFromDir(fullDir);
            }
            return restored;
        } catch {
            return 0;
        }
    }

    async persistSession(session: FlowSession): Promise<string> {
        const sessionDir = path.join(this.persistPath, "sessions");
        await this.fileSystem.createDir(sessionDir);
        const target = path.join(sessionDir, `${session.id}.json`);
        await this.fileSystem.writeFile(target, JSON.stringify(session, null, 2));
        this.updateIndexForSession(session, target);
        await this.persistIndex();
        return target;
    }

    async restoreSession(sessionId: string): Promise<FlowSession | undefined> {
        try {
            const sessionDir = path.join(this.persistPath, "sessions");
            const filePath = path.join(sessionDir, `${sessionId}.json`);
            const raw = await this.fileSystem.readFile(filePath);
            const session = JSON.parse(raw) as FlowSession;
            this.sessions.set(session.id, session);
            this.updateIndexForSession(session, filePath);
            return session;
        } catch {
            return undefined;
        }
    }

    private async removePersisted(id: ArtifactId): Promise<void> {
        try {
            const filePath = await this.resolvePersistPath(id);
            if (await this.fileSystem.exists(filePath)) {
                await this.fileSystem.deleteFile(filePath);
            }
        } catch {
            // ignore
        }
    }

    private updateIndexForArtifact(artifact: FlowArtifact, filePath?: string): void {
        const entry: FlowArtifactIndexEntry = {
            type: artifact.type,
            sessionId: artifact.sessionId,
            createdAt: artifact.createdAt
        };
        if (filePath) {
            entry.path = this.toRelativePersistPath(filePath);
        }
        this.index.artifacts[artifact.id] = {
            ...this.index.artifacts[artifact.id],
            ...entry
        };
        this.touchIndex();
        if (this.options.autoPersist) {
            void this.persistIndex();
        }
    }

    private updateIndexForSession(session: FlowSession, filePath?: string): void {
        const entry: FlowSessionIndexEntry = {
            status: session.status,
            updatedAt: session.updatedAt ?? session.startedAt
        };
        if (filePath) {
            entry.path = this.toRelativePersistPath(filePath);
        }
        this.index.sessions[session.id] = {
            ...this.index.sessions[session.id],
            ...entry
        };
        this.touchIndex();
        if (this.options.autoPersist) {
            void this.persistIndex();
        }
    }

    private removeIndexEntry(id: ArtifactId): void {
        if (this.index.artifacts[id]) {
            delete this.index.artifacts[id];
            this.touchIndex();
            if (this.options.autoPersist) {
                void this.persistIndex();
            }
        }
    }

    private touchIndex(): void {
        this.index.updatedAt = Date.now();
    }

    private async removeOrphanedArtifacts(): Promise<number> {
        let deleted = 0;
        const entries = await this.safeReadDirEntries(this.persistPath);
        for (const entry of entries) {
            if (!entry.isDirectory) continue;
            if (entry.name === "sessions") continue;
            const dirPath = path.join(this.persistPath, entry.name);
            const files = await this.safeReadDirEntries(dirPath);
            for (const file of files) {
                if (!file.isFile || !file.name.endsWith(".json")) continue;
                const artifactId = file.name.replace(/\.json$/, "");
                if (!this.index.artifacts[artifactId]) {
                    const orphanPath = path.join(dirPath, file.name);
                    if (await this.fileSystem.exists(orphanPath)) {
                        await this.fileSystem.deleteFile(orphanPath);
                    }
                    deleted += 1;
                }
            }
        }
        return deleted;
    }

    private async countOrphanedArtifacts(index: FlowArtifactIndex): Promise<number> {
        let count = 0;
        const entries = await this.safeReadDirEntries(this.persistPath);
        for (const entry of entries) {
            if (!entry.isDirectory) continue;
            if (entry.name === "sessions") continue;
            const dirPath = path.join(this.persistPath, entry.name);
            const files = await this.safeReadDirEntries(dirPath);
            for (const file of files) {
                if (!file.isFile || !file.name.endsWith(".json")) continue;
                const artifactId = file.name.replace(/\.json$/, "");
                if (!index.artifacts[artifactId]) {
                    count += 1;
                }
            }
        }
        return count;
    }

    private async removeOrphanedSessions(): Promise<number> {
        let deleted = 0;
        const sessionDir = path.join(this.persistPath, "sessions");
        const entries = await this.safeReadDirEntries(sessionDir);
        for (const entry of entries) {
            if (!entry.isFile || !entry.name.endsWith(".json")) continue;
            const sessionId = entry.name.replace(/\.json$/, "");
            if (!this.index.sessions[sessionId]) {
                const orphanPath = path.join(sessionDir, entry.name);
                if (await this.fileSystem.exists(orphanPath)) {
                    await this.fileSystem.deleteFile(orphanPath);
                }
                deleted += 1;
            }
        }
        return deleted;
    }

    private async countOrphanedSessions(index: FlowArtifactIndex): Promise<number> {
        let count = 0;
        const sessionDir = path.join(this.persistPath, "sessions");
        const entries = await this.safeReadDirEntries(sessionDir);
        for (const entry of entries) {
            if (!entry.isFile || !entry.name.endsWith(".json")) continue;
            const sessionId = entry.name.replace(/\.json$/, "");
            if (!index.sessions[sessionId]) {
                count += 1;
            }
        }
        return count;
    }

    private async safeReadDirEntries(dirPath: string): Promise<Array<{ name: string; isFile: boolean; isDirectory: boolean }>> {
        try {
            const entries = await this.fileSystem.readDir(dirPath);
            const results: Array<{ name: string; isFile: boolean; isDirectory: boolean }> = [];
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry);
                try {
                    const stat = await this.fileSystem.stat(fullPath);
                    const isDirectory = stat.isDirectory();
                    results.push({ name: entry, isFile: !isDirectory, isDirectory });
                } catch {
                    continue;
                }
            }
            return results;
        } catch {
            return [];
        }
    }

    private async persistIndex(): Promise<void> {
        await this.fileSystem.createDir(this.persistPath);
        await this.fileSystem.writeFile(this.indexPath, JSON.stringify(this.index, null, 2));
    }

    private async restoreFromIndex(): Promise<number> {
        const index = await this.readIndex();
        if (!index) return -1;
        this.index = index;
        let restored = 0;
        const sessionEntries = Object.entries(index.sessions ?? {});
        for (const [sessionId, entry] of sessionEntries) {
            if (entry?.path) {
                const sessionPath = this.toAbsolutePersistPath(entry.path);
                await this.restoreSessionFromPath(sessionId, sessionPath);
            } else {
                await this.restoreSession(sessionId);
            }
        }
        const artifactEntries = Object.entries(index.artifacts ?? {});
        for (const [artifactId, entry] of artifactEntries) {
            const type = entry?.type as ArtifactType | undefined;
            const pathOverride = entry?.path ? this.toAbsolutePersistPath(entry.path) : undefined;
            const filePath = pathOverride ?? await this.resolvePersistPath(artifactId as ArtifactId, type);
            const artifact = await this.importFromPath(filePath);
            if (artifact) restored += 1;
        }
        return restored;
    }

    private async restoreSessionFromPath(sessionId: string, filePath: string): Promise<FlowSession | undefined> {
        try {
            const raw = await this.fileSystem.readFile(filePath);
            const session = JSON.parse(raw) as FlowSession;
            if (session.id !== sessionId) {
                session.id = sessionId;
            }
            this.sessions.set(session.id, session);
            this.updateIndexForSession(session, filePath);
            return session;
        } catch {
            return undefined;
        }
    }

    private async readIndex(): Promise<FlowArtifactIndex | null> {
        try {
            const raw = await this.fileSystem.readFile(this.indexPath);
            const parsed = JSON.parse(raw) as FlowArtifactIndex;
            if (!parsed || typeof parsed !== "object") return null;
            return {
                version: parsed.version ?? 1,
                updatedAt: parsed.updatedAt ?? 0,
                artifacts: parsed.artifacts ?? {},
                sessions: parsed.sessions ?? {}
            };
        } catch {
            return null;
        }
    }

    private toRelativePersistPath(filePath: string): string {
        return path.relative(this.persistPath, filePath);
    }

    private toAbsolutePersistPath(relativePath: string): string {
        return path.join(this.persistPath, relativePath);
    }

    private async resolvePersistPath(id: ArtifactId, type?: ArtifactType, ensureDir?: boolean): Promise<string> {
        const folder = type ? `${type}s` : "";
        const basePath = folder ? path.join(this.persistPath, folder) : this.persistPath;
        if (ensureDir) {
            await this.fileSystem.createDir(basePath);
        }
        const candidate = path.join(basePath, `${id}.json`);
        if (type || ensureDir) {
            return candidate;
        }
        const types: ArtifactType[] = ["research", "analysis", "style", "draft", "review"];
        for (const entryType of types) {
            const entryPath = path.join(this.persistPath, `${entryType}s`, `${id}.json`);
            if (await this.fileSystem.exists(entryPath)) {
                return entryPath;
            }
        }
        return candidate;
    }

    private async restoreArtifactsFromDir(dir: string): Promise<number> {
        try {
            const entries = await this.fileSystem.readDir(dir);
            let restored = 0;
            for (const entry of entries) {
                if (!entry.endsWith(".json")) continue;
                const full = path.join(dir, entry);
                const artifact = await this.importFromPath(full);
                if (artifact) restored += 1;
            }
            return restored;
        } catch {
            return 0;
        }
    }

    private async restoreSessionsFromDir(dir: string): Promise<void> {
        try {
            const entries = await this.fileSystem.readDir(dir);
            for (const entry of entries) {
                if (!entry.endsWith(".json")) continue;
                const sessionId = entry.replace(/\.json$/, "");
                await this.restoreSession(sessionId);
            }
        } catch {
            // ignore
        }
    }

    private countByType(artifacts: FlowArtifact[]): Record<ArtifactType, number> {
        return artifacts.reduce((acc, artifact) => {
            acc[artifact.type] = (acc[artifact.type] ?? 0) + 1;
            return acc;
        }, {} as Record<ArtifactType, number>);
    }

    private mergePolicy(existing: SessionPolicy | undefined, patch: SessionPolicy): SessionPolicy {
        const base: SessionPolicy = existing ? { ...existing } : {};
        return {
            ...base,
            ...patch,
            explore: { ...(base.explore ?? {}), ...(patch.explore ?? {}) },
            understand: { ...(base.understand ?? {}), ...(patch.understand ?? {}) },
            write: { ...(base.write ?? {}), ...(patch.write ?? {}) },
            change: { ...(base.change ?? {}), ...(patch.change ?? {}) }
        };
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
        this.updateIndexForSession(session);
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
                if (!session.artifacts.drafts.includes(artifact.pack.id)) {
                    session.artifacts.drafts.push(artifact.pack.id);
                }
                break;
            case "review":
                if (!session.artifacts.reviews.includes(artifact.report.id)) {
                    session.artifacts.reviews.push(artifact.report.id);
                }
                break;
            default:
                break;
        }
        session.updatedAt = Date.now();
        this.updateIndexForSession(session);
        if (this.options.autoPersist) {
            void this.persistSession(session);
        }
    }

    private generateSessionId(): string {
        const suffix = Math.random().toString(36).slice(2, 8);
        return `session_${Date.now().toString(36)}_${suffix}`;
    }

    private detachFromSession(sessionId: string, artifact: FlowArtifact): void {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        switch (artifact.type) {
            case "research":
                if (session.artifacts.research === artifact.pack.id) {
                    delete session.artifacts.research;
                }
                break;
            case "analysis":
                if (session.artifacts.analysis === artifact.pack.id) {
                    delete session.artifacts.analysis;
                }
                break;
            case "style":
                if (session.artifacts.style === artifact.pack.id) {
                    delete session.artifacts.style;
                }
                break;
            case "draft":
                session.artifacts.drafts = session.artifacts.drafts.filter((id) => id !== artifact.pack.id);
                break;
            case "review":
                session.artifacts.reviews = session.artifacts.reviews.filter((id) => id !== artifact.report.id);
                if (session.outcome?.finalReviewId === artifact.report.id) {
                    session.outcome.finalReviewId = undefined;
                }
                break;
            default:
                break;
        }
        session.updatedAt = Date.now();
        this.updateIndexForSession(session);
        if (this.options.autoPersist) {
            void this.persistSession(session);
        }
    }
}
