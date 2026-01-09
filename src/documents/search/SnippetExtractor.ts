import type { StoredDocumentChunk } from "../../indexing/DocumentChunkRepository.js";
import type { DocumentSearchSection } from "./SearchTypes.js";

export function toSearchSection(
    chunk: StoredDocumentChunk,
    scores: { bm25: number; vector?: number; final: number },
    snippetLength: number
): DocumentSearchSection {
    const preview = chunk.text.length > snippetLength
        ? `${chunk.text.slice(0, Math.max(1, snippetLength - 1))}…`
        : chunk.text;
    return {
        id: chunk.id,
        filePath: chunk.filePath,
        kind: chunk.kind,
        sectionPath: chunk.sectionPath,
        heading: chunk.heading,
        headingLevel: chunk.headingLevel,
        range: { startLine: chunk.range.startLine, endLine: chunk.range.endLine },
        preview,
        scores
    };
}

export function limitEvidence(
    sections: DocumentSearchSection[],
    maxSections: number,
    maxChars: number
): DocumentSearchSection[] {
    const results: DocumentSearchSection[] = [];
    let totalChars = 0;
    for (const section of sections) {
        if (results.length >= maxSections) break;
        const next = totalChars + section.preview.length;
        if (next > maxChars) break;
        results.push(section);
        totalChars = next;
    }
    return results;
}
