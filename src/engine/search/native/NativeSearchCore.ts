import path from "path";
import { FeatureFlags } from "../../../config/FeatureFlags.js";
import { PathManager } from "../../../utils/PathManager.js";
import { NativeModuleLoader } from "../../../orchestration/capabilities/NativeModuleLoader.js";

export type NativeSearchCoreOptions = {
    writerMemoryMb?: number;
    kairoVersion?: string;
    repoId?: string;
};

export type NativeIndexDoc =
    | {
        kind: "code_file";
        repoId: string;
        path: string;
        ext?: string;
        mtimeMs?: number;
        contentHash?: string;
        content: string;
        symbols?: string[];
        pathDepth: number;
        callgraphRank: number;
    }
    | {
        kind: "doc_chunk";
        repoId: string;
        chunkId: string;
        docPath: string;
        headingPath?: string[];
        scope?: "docs" | "comments" | "logs" | "metrics";
        text: string;
        mtimeMs?: number;
        contentHash?: string;
    };

export type NativeDeleteTarget =
    | { kind: "code_file"; repoId: string; path: string }
    | { kind: "doc_chunk"; repoId: string; chunkId: string };

export type NativeSearchQuery = {
    kind: "code_file" | "doc_chunk" | "any";
    query: string;
    repoIds?: string[];
    limit: number;
    fileTypes?: string[];
    scopes?: Array<"docs" | "comments" | "logs" | "metrics">;
    debug?: boolean;
};

export type NativeSearchHit = {
    kind: "code_file" | "doc_chunk";
    repoId: string;
    path: string;
    chunkId?: string;
    score: number;
    scope?: "docs" | "comments" | "logs" | "metrics";
    signals?: string[];
    meta?: Record<string, string>;
};

export type NativeSearchStats = {
    docCount: number;
    segmentCount: number;
    indexVersion: number;
    schemaVersion: number;
    writeEnabled: boolean;
};

export type NativeSearchCoreClient = {
    upsert: (doc: NativeIndexDoc) => void;
    upsertMany: (docs: NativeIndexDoc[]) => void;
    deleteDoc: (target: NativeDeleteTarget) => void;
    commit: () => void;
    search: (query: NativeSearchQuery) => NativeSearchHit[];
    close: () => void;
    stats: () => NativeSearchStats;
    reset?: () => void;
};

type NativeSearchCoreBinding = {
    new (indexDir: string, options?: NativeSearchCoreOptions): {
        upsert: (doc: NativeIndexDoc) => void;
        upsertMany: (docs: NativeIndexDoc[]) => void;
        deleteDoc: (target: NativeDeleteTarget) => void;
        commit: () => void;
        search: (query: NativeSearchQuery) => NativeSearchHit[];
        close: () => void;
        stats: () => NativeSearchStats;
        reset?: () => void;
    };
};

export class NativeSearchError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

export class NativeSearchCore {
    private readonly core: InstanceType<NativeSearchCoreBinding>;
    private readonly indexDir: string;

    constructor(rootPath: string, options: NativeSearchCoreOptions = {}) {
        if (!FeatureFlags.isEnabled(FeatureFlags.RUST_CORE_ENABLED)) {
            throw new NativeSearchError("CAP_NATIVE_SEARCH_UNAVAILABLE", "Rust core disabled.");
        }

        const loader = NativeModuleLoader.getShared();
        const rust = loader.getRustCore();
        if (!rust || !("NativeSearchCore" in rust)) {
            throw new NativeSearchError("CAP_NATIVE_SEARCH_UNAVAILABLE", "Rust core is unavailable.");
        }

        const repoId = options.repoId;
        const baseDir = PathManager.getIndexDir(repoId);
        this.indexDir = path.join(baseDir, "v2-tantivy");
        const binding = rust.NativeSearchCore as NativeSearchCoreBinding;
        this.core = new binding(this.indexDir, options);
    }

    public upsert(doc: NativeIndexDoc): void {
        return this.wrapNativeCall(() => this.core.upsert(doc));
    }

    public upsertMany(docs: NativeIndexDoc[]): void {
        if (docs.length === 0) return;
        return this.wrapNativeCall(() => this.core.upsertMany(docs));
    }

    public deleteDoc(target: NativeDeleteTarget): void {
        return this.wrapNativeCall(() => this.core.deleteDoc(target));
    }

    public commit(): void {
        return this.wrapNativeCall(() => this.core.commit());
    }

    public search(query: NativeSearchQuery): NativeSearchHit[] {
        return this.wrapNativeCall(() => this.core.search(query));
    }

    public close(): void {
        return this.wrapNativeCall(() => this.core.close());
    }

    public stats(): NativeSearchStats {
        return this.wrapNativeCall(() => this.core.stats());
    }

    public reset(): void {
        const reset = this.core.reset;
        if (!reset) {
            throw new NativeSearchError("CAP_NATIVE_SEARCH_UNAVAILABLE", "Native search reset is unavailable.");
        }
        return this.wrapNativeCall(() => reset());
    }

    public getIndexDir(): string {
        return this.indexDir;
    }

    private wrapNativeCall<T>(fn: () => T): T {
        try {
            return fn();
        } catch (error: any) {
            const message = error?.message ? String(error.message) : String(error);
            const code = extractErrorCode(message);
            throw new NativeSearchError(code, message);
        }
    }
}

function extractErrorCode(message: string): string {
    const match = message.match(/^([A-Z0-9_]+)(?::|\b)/);
    if (match && match[1]) {
        return match[1];
    }
    if (message.includes("Failed to load core_rs")) {
        return "CAP_NATIVE_SEARCH_UNAVAILABLE";
    }
    return "NATIVE_SEARCH_FAILED";
}
