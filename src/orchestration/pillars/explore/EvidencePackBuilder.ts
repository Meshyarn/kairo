import crypto from "crypto";
import { ExploreItem } from "./ResultFormatter.js";
import { isLogPath } from "./FilteringStrategy.js";

export type ExplorePack = {
    packId: string;
    query: string;
    createdAt: number;
    expiresAt?: number;
    include: { docs: boolean; code: boolean; comments: boolean; logs: boolean };
    docs: ExploreItem[];
    code: ExploreItem[];
};

export function computeExplorePackId(query: string, options: Record<string, unknown>): string {
    const normalized = stableStringify({ query: String(query ?? ""), options });
    return crypto.createHash("sha256").update(normalized).digest("hex");
}

export function stableStringify(value: any): string {
    if (value === null || value === undefined) return String(value);
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map(v => stableStringify(v)).join(",")}]`;
    }
    if (typeof value === "object") {
        const keys = Object.keys(value).sort();
        const parts = keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
        return `{${parts.join(",")}}`;
    }
    return JSON.stringify(String(value));
}

export function parseItemsCursor(raw?: string): { docs: number; code: number } {
    if (!raw || typeof raw !== "string") return { docs: 0, code: 0 };
    try {
        const parsed = JSON.parse(raw);
        const docs = Number.isFinite(parsed?.docs) ? Math.max(0, parsed.docs) : 0;
        const code = Number.isFinite(parsed?.code) ? Math.max(0, parsed.code) : 0;
        return { docs, code };
    } catch {
        return { docs: 0, code: 0 };
    }
}

export function encodeItemsCursor(cursor: { docs: number; code: number }): string {
    return JSON.stringify({ docs: Math.max(0, cursor.docs), code: Math.max(0, cursor.code) });
}

export function filterDocsByInclude(
    docs: ExploreItem[],
    includeDocs: boolean,
    includeComments: boolean,
    includeLogs: boolean
): ExploreItem[] {
    if (!includeDocs && !includeComments && !includeLogs) return [];
    return docs.filter(item => {
        if (item.metadata?.kind === "code_comment") return includeComments;
        if (isLogPath(item.filePath)) return includeLogs || includeDocs;
        return includeDocs;
    });
}

export function slicePack(
    pack: ExplorePack,
    cursor: { docs: number; code: number },
    maxResults: number,
    includeDocs: boolean,
    includeCode: boolean,
    includeComments: boolean,
    includeLogs: boolean
): { docs: ExploreItem[]; code: ExploreItem[]; nextCursor?: string } {
    const docsFiltered = filterDocsByInclude(pack.docs, includeDocs, includeComments, includeLogs);
    const codeFiltered = includeCode ? pack.code : [];
    const docs = docsFiltered.slice(cursor.docs, cursor.docs + maxResults);
    const code = codeFiltered.slice(cursor.code, cursor.code + maxResults);
    const nextDocs = cursor.docs + docs.length;
    const nextCode = cursor.code + code.length;
    const hasMore = nextDocs < docsFiltered.length || nextCode < codeFiltered.length;
    return {
        docs,
        code,
        nextCursor: hasMore ? encodeItemsCursor({ docs: nextDocs, code: nextCode }) : undefined
    };
}

export function computeNextCursor(
    pack: ExplorePack,
    cursor: { docs: number; code: number },
    maxResults: number,
    includeDocs: boolean,
    includeCode: boolean,
    includeComments: boolean,
    includeLogs: boolean
): string | undefined {
    const sliced = slicePack(pack, cursor, maxResults, includeDocs, includeCode, includeComments, includeLogs);
    return sliced.nextCursor;
}
