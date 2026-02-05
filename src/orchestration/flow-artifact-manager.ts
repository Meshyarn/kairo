import crypto from "crypto";
import path from "path";
import { LRUCache } from "lru-cache";
import { NodeFileSystem, type IFileSystem } from "../platform/FileSystem.js";
import { PathManager } from "../utils/PathManager.js";
import type {
  ArtifactId,
  ArtifactManagerStatus,
  ArtifactType,
  ApplyTokenRecord,
  FlowArtifact,
  FlowSession,
  FlowSessionOutcome,
  SessionPolicy,
  StylePack,
  AnalysisPack
} from "../types/flow-artifacts.js";
import type { ApplyTokenValidationResult, FlowArtifactIndex, FlowArtifactManagerOptions, FlowArtifactManagerState } from "./flow-artifact-manager.types.js";
import { removeIndexEntry, updateIndexForArtifact, updateIndexForSession } from "./flow-artifact-manager.index.js";
import {
  importFromPath as importArtifactFromPath,
  persistArtifact,
  persistSession as persistSessionData,
  planPrunePersisted as planPrunePersistedArtifacts,
  prunePersisted as prunePersistedArtifacts,
  removePersisted,
  restoreAll as restoreAllArtifacts,
  restoreArtifact,
  restoreSession as restoreSessionData
} from "./flow-artifact-manager.persistence.js";

export type { ApplyTokenValidationResult, FlowArtifactManagerOptions } from "./flow-artifact-manager.types.js";

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
    this.persistPath = options.persistPath ?? PathManager.resolve("flow-artifacts");
    this.indexPath = path.join(this.persistPath, "index.json");
    this.sessions = new Map<string, FlowSession>();
    this.index = {
      version: 1,
      updatedAt: 0,
      artifacts: {},
      sessions: {}
    };
  }

  private getState(): FlowArtifactManagerState {
    return this as unknown as FlowArtifactManagerState;
  }

  store<T extends FlowArtifact>(artifact: T): ArtifactId {
    const stored = { ...artifact };
    this.cache.set(stored.id, stored);
    updateIndexForArtifact(this.getState(), stored);
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

  listArtifacts(): FlowArtifact[] {
    return Array.from(this.cache.values());
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
      review: rawCounts.review ?? 0,
      graph: rawCounts.graph ?? 0,
      schema: rawCounts.schema ?? 0,
      evidence: rawCounts.evidence ?? 0
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
      review: session.artifacts.reviews.slice(-1)[0],
      graph: session.artifacts.graphs?.slice(-1)[0],
      schema: undefined,
      evidence: session.artifacts.evidence?.slice(-1)[0]
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

  issueApplyToken(args: { sessionId: string; draftId: string; ttlMs?: number; now?: number }): { token: string; issuedAt: number; expiresAt: number } | undefined {
    const session = this.sessions.get(args.sessionId);
    if (!session || !args.draftId) return undefined;
    const now = args.now ?? Date.now();
    const ttlMs = args.ttlMs ?? this.options.defaultTTL ?? 30 * 60 * 1000;
    const token = crypto.randomBytes(24).toString("hex");
    const record: ApplyTokenRecord = {
      draftId: args.draftId,
      tokenHash: this.hashApplyToken(token),
      issuedAt: now,
      expiresAt: now + ttlMs
    };
    session.applyTokens = {
      ...(session.applyTokens ?? {}),
      [args.draftId]: record
    };
    session.updatedAt = now;
    updateIndexForSession(this.getState(), session);
    if (this.options.autoPersist) {
      void this.persistSession(session);
    }
    return { token, issuedAt: record.issuedAt, expiresAt: record.expiresAt };
  }

  validateApplyToken(args: {
    sessionId?: string;
    draftId?: string;
    token?: string;
    now?: number;
    oneTime?: boolean;
    consume?: boolean;
  }): ApplyTokenValidationResult {
    if (!args.sessionId || !args.draftId || !args.token) {
      return { valid: false, reason: "missing" };
    }
    const session = this.sessions.get(args.sessionId);
    if (!session) {
      return { valid: false, reason: "missing" };
    }
    const record = session.applyTokens?.[args.draftId];
    if (!record) {
      return { valid: false, reason: "missing" };
    }
    const now = args.now ?? Date.now();
    if (record.expiresAt <= now) {
      return { valid: false, reason: "expired", issuedAt: record.issuedAt, expiresAt: record.expiresAt };
    }
    const oneTime = args.oneTime !== false;
    if (oneTime && record.usedAt) {
      return { valid: false, reason: "used", issuedAt: record.issuedAt, expiresAt: record.expiresAt };
    }
    const tokenHash = this.hashApplyToken(args.token);
    if (tokenHash !== record.tokenHash) {
      return { valid: false, reason: "invalid", issuedAt: record.issuedAt, expiresAt: record.expiresAt };
    }
    if (args.consume && oneTime) {
      record.usedAt = now;
      session.updatedAt = now;
      updateIndexForSession(this.getState(), session);
      if (this.options.autoPersist) {
        void this.persistSession(session);
      }
    }
    return { valid: true, issuedAt: record.issuedAt, expiresAt: record.expiresAt };
  }

  invalidateApplyToken(sessionId: string, draftId: string, now?: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.applyTokens?.[draftId]) return false;
    const record = session.applyTokens[draftId];
    const timestamp = now ?? Date.now();
    record.usedAt = timestamp;
    if (record.expiresAt > timestamp) {
      record.expiresAt = timestamp;
    }
    session.updatedAt = timestamp;
    updateIndexForSession(this.getState(), session);
    if (this.options.autoPersist) {
      void this.persistSession(session);
    }
    return true;
  }

  completeSession(sessionId: string, outcome?: FlowSessionOutcome): FlowSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    session.status = "completed";
    session.outcome = outcome;
    session.updatedAt = Date.now();
    updateIndexForSession(this.getState(), session);
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
    updateIndexForSession(this.getState(), session);
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
    removeIndexEntry(this.getState(), id);
    void removePersisted(this.getState(), id);
    return existed;
  }

  prune(): number {
    const before = this.cache.size;
    this.cache.purgeStale();
    return before - this.cache.size;
  }

  async prunePersisted(options: { removeOrphans?: boolean } = {}): Promise<{ deletedFiles: number; fixedIndexEntries: number; removedSessions: number }> {
    return prunePersistedArtifacts(this.getState(), options);
  }

  async planPrunePersisted(options: { removeOrphans?: boolean } = {}): Promise<{ deletedFiles: number; fixedIndexEntries: number; removedSessions: number }> {
    return planPrunePersistedArtifacts(this.getState(), options);
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
    return persistArtifact(this.getState(), id, artifact);
  }

  async restore(id: ArtifactId): Promise<FlowArtifact | undefined> {
    return restoreArtifact(this.getState(), id, (artifact) => this.store(artifact));
  }

  async importFromPath(filePath: string): Promise<FlowArtifact | undefined> {
    return importArtifactFromPath(this.getState(), filePath, (artifact) => this.store(artifact));
  }

  async restoreAll(): Promise<number> {
    return restoreAllArtifacts(this.getState(), (artifact) => this.store(artifact));
  }

  async persistSession(session: FlowSession): Promise<string> {
    return persistSessionData(this.getState(), session);
  }

  async restoreSession(sessionId: string): Promise<FlowSession | undefined> {
    return restoreSessionData(this.getState(), sessionId);
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
                reviews: [],
                graphs: [],
                evidence: []
            }
        };
        this.sessions.set(session.id, session);
        updateIndexForSession(this.getState(), session);
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
            case "graph":
                if (!session.artifacts.graphs) {
                    session.artifacts.graphs = [];
                }
                if (!session.artifacts.graphs.includes(artifact.pack.id)) {
                    session.artifacts.graphs.push(artifact.pack.id);
                }
                break;
            case "evidence":
                if (!session.artifacts.evidence) {
                    session.artifacts.evidence = [];
                }
                if (!session.artifacts.evidence.includes(artifact.pack.id)) {
                    session.artifacts.evidence.push(artifact.pack.id);
                }
                break;
            default:
                break;
        }
        session.updatedAt = Date.now();
        updateIndexForSession(this.getState(), session);
        if (this.options.autoPersist) {
            void this.persistSession(session);
        }
    }

  private generateSessionId(): string {
        const suffix = Math.random().toString(36).slice(2, 8);
        return `session_${Date.now().toString(36)}_${suffix}`;
    }

  private hashApplyToken(token: string): string {
        return crypto.createHash("sha256").update(token).digest("hex");
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
            case "graph":
                if (session.artifacts.graphs) {
                    session.artifacts.graphs = session.artifacts.graphs.filter((id) => id !== artifact.pack.id);
                }
                break;
            case "evidence":
                if (session.artifacts.evidence) {
                    session.artifacts.evidence = session.artifacts.evidence.filter((id) => id !== artifact.pack.id);
                }
                break;
            default:
                break;
        }
        session.updatedAt = Date.now();
        updateIndexForSession(this.getState(), session);
        if (this.options.autoPersist) {
            void this.persistSession(session);
        }
    }
}
