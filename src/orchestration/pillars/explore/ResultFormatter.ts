import type { IntegrityReport } from "../../../integrity/IntegrityTypes.js";
import type { IndexSnapshot } from "../../../indexing/IndexStateManager.js";
import type { ResearchPack } from "../../../types/flow-artifacts.js";
import type { DegradedReason } from "../../../types/tool-responses.js";

export type ExploreItem = {
    kind: "document_section" | "file_preview" | "file_full" | "symbol" | "directory";
    filePath: string;
    title?: string;
    score?: number;
    range?: { startLine?: number; endLine?: number };
    preview?: string;
    content?: string;
    metadata?: Record<string, unknown>;
    why?: string[];
};

export type ExploreResponse = {
    success: boolean;
    status: "ok" | "no_results" | "invalid_args" | "blocked" | "error";
    message?: string;
    query?: string;
    data: { docs: ExploreItem[]; code: ExploreItem[] };
    pack?: { packId: string; hit: boolean; createdAt: number; expiresAt?: number };
    next?: { itemsCursor?: string; contentCursor?: string };
    integrity?: IntegrityReport;
    degraded?: boolean;
    reasons?: string[];
    degradedReasons?: DegradedReason[];
    stats?: Record<string, unknown>;
    researchPack?: ResearchPack;
    insights?: Array<{
        type: "info" | "warning" | "error";
        message: string;
        relatedSymbols: string[];
        suggestedAction?: string;
    }>;
    indexSnapshot?: IndexSnapshot;
    sessionId?: string;
    effectiveOptions?: Record<string, unknown>;
    decisionTrace?: Record<string, unknown>;
};

const DEFAULT_MAX_CHARS = 8000;

export function truncate(text: string, maxChars: number): string {
    const limit = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : DEFAULT_MAX_CHARS;
    const value = String(text ?? "");
    if (value.length <= limit) return value;
    return `${value.slice(0, Math.max(1, limit - 1))}…`;
}
