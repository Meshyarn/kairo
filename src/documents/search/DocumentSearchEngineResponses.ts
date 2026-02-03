import { LRUCache } from "lru-cache";
import type { EvidencePackRepository } from "../../indexing/EvidencePackRepository.js";
import { computeRootFingerprint } from "../../indexing/EvidencePackRepository.js";
import type { IndexDatabase } from "../../indexing/IndexDatabase.js";
import type { DocumentSearchOptions, DocumentSearchResponse } from "./SearchTypes.js";
import { attachFileMeta } from "./DocumentSearchEngineHelpers.js";

type PackCacheEntry = {
    response: DocumentSearchResponse;
    createdAt: number;
    expiresAt?: number;
    staleCheckItems: Array<{ chunkId: string; snapshot?: { contentHash?: string } }>;
};

export const buildEmptyQueryResponse = (query: string): DocumentSearchResponse => ({
    query,
    results: [],
    evidence: [],
    degraded: false,
    reason: undefined,
    reasons: undefined,
    provider: null,
    stats: {
        candidateFiles: 0,
        candidateChunks: 0,
        vectorEnabled: false,
        mmrApplied: false,
        evidenceSections: 0,
        evidenceChars: 0,
        evidenceTruncated: false
    }
});

export const handleNoChunks = (args: {
    query: string;
    includeEvidence: boolean;
    candidateFiles: string[];
    degradationReasons: string[];
    packCache: LRUCache<string, PackCacheEntry>;
    effectivePackId: string;
    packTtlMs: number;
    options: DocumentSearchOptions;
    output: DocumentSearchOptions["output"];
    snippetLength: number;
    maxEvidenceChars: number;
    maxEvidenceSections: number;
    maxResults: number;
    rootPath: string;
    evidencePacks?: EvidencePackRepository;
    indexDatabase?: IndexDatabase;
}): DocumentSearchResponse => {
    const uniqueReasons = Array.from(new Set(args.degradationReasons.filter(Boolean)));
    const degradedAny = uniqueReasons.length > 0;
    const reason = degradedAny ? uniqueReasons[0] : undefined;
    const response: DocumentSearchResponse = {
        query: args.query,
        results: [],
        evidence: args.includeEvidence ? [] : undefined,
        degraded: degradedAny,
        reason,
        reasons: degradedAny ? uniqueReasons : undefined,
        provider: null,
        stats: {
            candidateFiles: args.candidateFiles.length,
            candidateChunks: 0,
            vectorEnabled: false,
            mmrApplied: false,
            evidenceSections: 0,
            evidenceChars: 0,
            evidenceTruncated: false
        }
    };
    const createdAt = Date.now();
    const expiresAt = Number.isFinite(args.packTtlMs) && args.packTtlMs > 0 ? createdAt + args.packTtlMs : undefined;
    args.packCache.set(args.effectivePackId, { response, createdAt, expiresAt, staleCheckItems: [] });
    if (args.evidencePacks) {
        try {
            args.evidencePacks.upsertPack({
                packId: args.effectivePackId,
                query: args.query,
                createdAt,
                expiresAt,
                rootFingerprint: computeRootFingerprint(args.rootPath),
                options: {
                    ...args.options,
                    output: args.output,
                    includeEvidence: args.includeEvidence,
                    snippetLength: args.snippetLength,
                    maxEvidenceChars: args.maxEvidenceChars,
                    maxEvidenceSections: args.maxEvidenceSections,
                    maxResults: args.maxResults
                },
                meta: {
                    degraded: response.degraded,
                    reason: response.reason,
                    reasons: response.reasons,
                    provider: response.provider,
                    stats: response.stats as any
                },
                items: []
            });
        } catch {
            // best-effort
        }
    }
    return attachFileMeta({
        response: {
            ...response,
            pack: { packId: args.effectivePackId, hit: false, createdAt, expiresAt }
        },
        indexDatabase: args.indexDatabase
    });
};
