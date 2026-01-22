import path from "path";
import type {
    NativeDeleteTarget,
    NativeIndexDoc,
    NativeSearchCoreClient,
    NativeSearchHit,
    NativeSearchQuery,
    NativeSearchStats
} from "../../engine/search/native/NativeSearchCore.js";

type StoredDoc =
    | (NativeIndexDoc & { kind: "code_file"; path: string; repoId: string; content: string })
    | (NativeIndexDoc & { kind: "doc_chunk"; chunkId: string; docPath: string; repoId: string; text: string });

export class NativeSearchCoreStub implements NativeSearchCoreClient {
    private readonly docs = new Map<string, StoredDoc>();

    upsert(doc: NativeIndexDoc): void {
        const stored = this.normalizeDoc(doc);
        this.docs.set(this.keyFor(stored), stored);
    }

    upsertMany(docs: NativeIndexDoc[]): void {
        for (const doc of docs) {
            this.upsert(doc);
        }
    }

    deleteDoc(target: NativeDeleteTarget): void {
        const key = this.keyForDelete(target);
        if (key) {
            this.docs.delete(key);
        }
    }

    commit(): void {
        // no-op for stub
    }

    reset(): void {
        this.docs.clear();
    }

    search(query: NativeSearchQuery): NativeSearchHit[] {
        const tokens = tokenizeQuery(query.query);
        if (tokens.length === 0) {
            return [];
        }
        const repoIds = Array.isArray(query.repoIds) && query.repoIds.length > 0 ? new Set(query.repoIds) : null;
        const fileTypes = Array.isArray(query.fileTypes) && query.fileTypes.length > 0
            ? new Set(query.fileTypes.map((ext) => String(ext)).filter(Boolean))
            : null;
        const scopes = Array.isArray(query.scopes) && query.scopes.length > 0 ? new Set(query.scopes) : null;
        const kinds = query.kind === "any" ? new Set(["code_file", "doc_chunk"]) : new Set([query.kind]);

        const hits: Array<{ hit: NativeSearchHit; score: number }> = [];
        for (const stored of this.docs.values()) {
            if (!kinds.has(stored.kind)) continue;
            if (repoIds && !repoIds.has(stored.repoId)) continue;
            if (stored.kind === "code_file" && fileTypes) {
                const ext = stored.ext ?? path.extname(stored.path).replace(".", "").toLowerCase();
                if (!fileTypes.has(ext)) continue;
            }
            if (stored.kind === "doc_chunk" && scopes) {
                const scope: "docs" | "comments" | "logs" | "metrics" = stored.scope ?? "docs";
                if (!scopes.has(scope)) continue;
            }

            const haystack = buildHaystack(stored).toLowerCase();
            const score = scoreTokens(tokens, haystack);
            if (score <= 0) continue;

            hits.push({
                hit: {
                    kind: stored.kind,
                    repoId: stored.repoId,
                    path: stored.kind === "doc_chunk" ? stored.docPath : stored.path,
                    chunkId: stored.kind === "doc_chunk" ? stored.chunkId : undefined,
                    score,
                    scope: stored.kind === "doc_chunk" ? stored.scope : undefined
                },
                score
            });
        }

        hits.sort((a, b) => b.score - a.score);
        return hits.slice(0, Math.max(1, query.limit)).map((entry) => entry.hit);
    }

    close(): void {
        // no-op for stub
    }

    stats(): NativeSearchStats {
        return {
            docCount: this.docs.size,
            segmentCount: 1,
            indexVersion: 1,
            schemaVersion: 1,
            writeEnabled: true
        };
    }

    private keyFor(doc: StoredDoc): string {
        if (doc.kind === "code_file") {
            return `${doc.repoId}:code_file:${doc.path}`;
        }
        return `${doc.repoId}:doc_chunk:${doc.chunkId}`;
    }

    private keyForDelete(target: NativeDeleteTarget): string | null {
        if (target.kind === "code_file" && target.path) {
            return `${target.repoId}:code_file:${target.path}`;
        }
        if (target.kind === "doc_chunk" && target.chunkId) {
            return `${target.repoId}:doc_chunk:${target.chunkId}`;
        }
        return null;
    }

    private normalizeDoc(doc: NativeIndexDoc): StoredDoc {
        if (doc.kind === "code_file") {
            if (!doc.path || !doc.content) {
                throw new Error("Stub requires code_file path/content.");
            }
            return {
                ...doc,
                kind: "code_file",
                repoId: doc.repoId,
                path: doc.path,
                content: doc.content
            };
        }
        if (!doc.chunkId || !doc.docPath || !doc.text) {
            throw new Error("Stub requires doc_chunk chunkId/docPath/text.");
        }
        return {
            ...doc,
            kind: "doc_chunk",
            repoId: doc.repoId,
            chunkId: doc.chunkId,
            docPath: doc.docPath,
            text: doc.text
        };
    }
}

function tokenizeQuery(query: string): string[] {
    return query
        .split(/\s+/)
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length > 0);
}

function scoreTokens(tokens: string[], haystack: string): number {
    let score = 0;
    for (const token of tokens) {
        const count = countOccurrences(haystack, token);
        if (count > 0) {
            score += count;
        }
    }
    return score;
}

function countOccurrences(haystack: string, needle: string): number {
    if (!needle) return 0;
    let count = 0;
    let index = haystack.indexOf(needle);
    while (index >= 0) {
        count += 1;
        index = haystack.indexOf(needle, index + needle.length);
    }
    return count;
}

function buildHaystack(doc: StoredDoc): string {
    if (doc.kind === "code_file") {
        const symbols = Array.isArray(doc.symbols) ? doc.symbols.join(" ") : "";
        return `${doc.path}\n${symbols}\n${doc.content}`;
    }
    const headings = Array.isArray(doc.headingPath) ? doc.headingPath.join(" ") : "";
    return `${doc.docPath}\n${headings}\n${doc.text}`;
}
