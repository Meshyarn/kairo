export type EmbeddingProvider = "local" | "remote" | "disabled";

export interface EmbeddingVector {
    provider: EmbeddingProvider;
    model: string;
    dims: number;
    values: Float32Array;
    norm?: number;
}

export interface EmbeddingConfig {
    provider?: "auto" | EmbeddingProvider | "hash";
    normalize?: boolean;
    batchSize?: number;
    timeoutMs?: number;
    concurrency?: number;
    maxQueueSize?: number;
    modelCacheDir?: string;
    modelDir?: string;
    local?: {
        model?: string;
        dims?: number;
        quantized?: boolean;
    };
}

export interface IndexStatus {
    global: {
        totalFiles: number;
        indexedFiles: number;
        unresolvedImports: number;
        resolutionErrors: Array<{ filePath: string; importSpecifier: string; error: string; }>;
        lastRebuiltAt: string; // ISO date string
        confidence: "high" | "medium" | "low";
        isMonorepo: boolean;
    };
    perFile?: Record<string, {
        resolved: boolean;
        unresolvedImports: string[];
        incomingDependenciesCount: number;
        outgoingDependenciesCount: number;
    }>;
}

export interface EngineConfig {
    mode?: "prod" | "ci" | "test";
    parserBackend?: "wasm" | "js" | "snapshot" | "auto";
    snapshotDir?: string;
    rootPath?: string;
}
