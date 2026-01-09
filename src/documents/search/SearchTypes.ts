import type { DocumentKind, EmbeddingConfig } from "../../types.js";

export interface DocumentSearchOptions {
    scope?: "docs" | "project" | "all";
    output?: "full" | "compact" | "pack_only";
    packId?: string;
    maxResults?: number;
    maxCandidates?: number;
    maxChunkCandidates?: number;
    maxVectorCandidates?: number;
    maxEvidenceSections?: number;
    maxEvidenceChars?: number;
    includeEvidence?: boolean;
    snippetLength?: number;
    rrfK?: number;
    rrfDepth?: number;
    useMmr?: boolean;
    mmrLambda?: number;
    maxChunksEmbeddedPerRequest?: number;
    maxEmbeddingTimeMs?: number;
    embedding?: EmbeddingConfig;
    includeComments?: boolean;
    includeLogs?: boolean;
    includeMetrics?: boolean;
}

export interface DocumentSearchSection {
    id: string;
    filePath: string;
    kind: DocumentKind;
    sectionPath: string[];
    heading: string | null;
    headingLevel: number | null;
    range: { startLine: number; endLine: number };
    preview: string;
    scores: { bm25: number; vector?: number; final: number };
}

export interface DocumentSearchResponse {
    query: string;
    results: DocumentSearchSection[];
    evidence?: DocumentSearchSection[];
    pack?: {
        packId: string;
        hit: boolean;
        createdAt: number;
        expiresAt?: number;
    };
    degraded?: boolean;
    reason?: string;
    reasons?: string[];
    provider?: { name: string; model: string; dims: number } | null;
    stats: {
        candidateFiles: number;
        candidateChunks: number;
        vectorEnabled: boolean;
        mmrApplied: boolean;
        evidenceSections: number;
        evidenceChars: number;
        evidenceTruncated: boolean;
    };
}
