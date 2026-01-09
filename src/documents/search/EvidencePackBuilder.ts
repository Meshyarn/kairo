import type { StoredDocumentChunk } from "../../indexing/DocumentChunkRepository.js";
import type { EvidencePackRepository, StoredEvidencePack } from "../../indexing/EvidencePackRepository.js";
import { buildDeterministicPreview } from "../summary/DeterministicSummarizer.js";
import type { DocumentSearchResponse, DocumentSearchSection } from "./SearchTypes.js";

export function buildStaleCheckItems(
    results: DocumentSearchSection[],
    evidence: DocumentSearchSection[] | undefined,
    includeEvidence: boolean,
    chunks: StoredDocumentChunk[]
): Array<{ chunkId: string; snapshot?: { contentHash?: string } }> {
    const byId = new Map(chunks.map(c => [c.id, c]));
    const out: Array<{ chunkId: string; snapshot?: { contentHash?: string } }> = [];
    for (const r of results) {
        const chunk = byId.get(r.id);
        if (!chunk?.contentHash) continue;
        out.push({ chunkId: r.id, snapshot: { contentHash: chunk.contentHash } });
    }
    if (includeEvidence && Array.isArray(evidence)) {
        for (const e of evidence) {
            const chunk = byId.get(e.id);
            if (!chunk?.contentHash) continue;
            out.push({ chunkId: e.id, snapshot: { contentHash: chunk.contentHash } });
        }
    }
    return out;
}

export function hydrateResponseFromPack(
    pack: StoredEvidencePack,
    output: "full" | "compact" | "pack_only",
    includeEvidence: boolean
): DocumentSearchResponse {
    const items = pack.items ?? [];
    const results = items.filter(i => i.role === "result").map(i => ({
        id: i.chunkId,
        filePath: i.filePath,
        kind: i.kind,
        sectionPath: i.sectionPath,
        heading: i.heading,
        headingLevel: i.headingLevel,
        range: i.range,
        preview: output === "pack_only" ? "" : i.preview,
        scores: i.scores ?? { bm25: 0, final: 0 }
    }));
    const evidence = includeEvidence
        ? items.filter(i => i.role === "evidence").map(i => ({
            id: i.chunkId,
            filePath: i.filePath,
            kind: i.kind,
            sectionPath: i.sectionPath,
            heading: i.heading,
            headingLevel: i.headingLevel,
            range: i.range,
            preview: output === "pack_only" ? "" : i.preview,
            scores: i.scores ?? { bm25: 0, final: 0 }
        }))
        : undefined;

    const meta = pack.meta ?? {};
    const fallbackStats: DocumentSearchResponse["stats"] = {
        candidateFiles: 0,
        candidateChunks: 0,
        vectorEnabled: false,
        mmrApplied: false,
        evidenceSections: evidence?.length ?? 0,
        evidenceChars: (evidence ?? []).reduce((sum: number, s: any) => sum + (s.preview?.length ?? 0), 0),
        evidenceTruncated: false
    };
    const stats = {
        ...fallbackStats,
        ...(meta.stats as any)
    } as DocumentSearchResponse["stats"];

    return {
        query: pack.query,
        results,
        evidence,
        degraded: meta.degraded ?? false,
        reason: meta.reason,
        reasons: meta.reasons,
        provider: meta.provider ?? null,
        stats
    };
}

export function toStoredItems(
    results: DocumentSearchSection[],
    evidence: DocumentSearchSection[] | undefined,
    includeEvidence: boolean,
    chunks: StoredDocumentChunk[],
    bm25ScoreMap: Map<string, number>,
    vectorScores: Map<string, number>,
    vectorEnabled: boolean
) {
    const byId = new Map(chunks.map(c => [c.id, c]));
    const out: any[] = [];
    let rank = 0;
    for (const r of results) {
        rank += 1;
        const chunk = byId.get(r.id);
        out.push({
            role: "result",
            rank,
            chunkId: r.id,
            filePath: r.filePath,
            kind: r.kind,
            sectionPath: r.sectionPath,
            heading: r.heading,
            headingLevel: r.headingLevel,
            range: r.range,
            preview: r.preview ?? "",
            scores: {
                bm25: bm25ScoreMap.get(r.id) ?? 0,
                vector: vectorEnabled ? vectorScores.get(r.id) : undefined,
                final: r.scores?.final ?? 0
            },
            snapshot: { contentHash: chunk?.contentHash, updatedAt: chunk?.updatedAt }
        });
    }
    if (includeEvidence && Array.isArray(evidence)) {
        let eRank = 0;
        for (const e of evidence) {
            eRank += 1;
            const chunk = byId.get(e.id);
            out.push({
                role: "evidence",
                rank: eRank,
                chunkId: e.id,
                filePath: e.filePath,
                kind: e.kind,
                sectionPath: e.sectionPath,
                heading: e.heading,
                headingLevel: e.headingLevel,
                range: e.range,
                preview: e.preview ?? "",
                scores: {
                    bm25: bm25ScoreMap.get(e.id) ?? 0,
                    vector: vectorEnabled ? vectorScores.get(e.id) : undefined,
                    final: e.scores?.final ?? 0
                },
                snapshot: { contentHash: chunk?.contentHash, updatedAt: chunk?.updatedAt }
            });
        }
    }
    return out;
}

export function fillPreviewsFromSummaries(
    sections: DocumentSearchSection[],
    chunkById: Map<string, StoredDocumentChunk>,
    query: string,
    maxChars: number,
    evidencePacks?: EvidencePackRepository
): void {
    for (const section of sections) {
        const chunk = chunkById.get(section.id);
        if (!chunk) continue;
        const cached = evidencePacks?.getSummary(section.id, "preview", chunk.contentHash);
        if (cached) {
            section.preview = cached.length > maxChars ? `${cached.slice(0, Math.max(1, maxChars - 1))}…` : cached;
            continue;
        }
        const built = buildDeterministicPreview({
            text: chunk.text,
            query,
            kind: chunk.kind,
            maxChars
        });
        section.preview = built.preview;
        try {
            evidencePacks?.upsertSummary(section.id, "preview", built.preview, chunk.contentHash);
        } catch {
            // best-effort
        }
    }
}
