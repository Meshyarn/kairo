import * as path from "path";
import * as fs from "fs";
import type { IFileSystem } from "../platform/FileSystem.js";
import { extractDocxAsHtml, DocxExtractError } from "./extractors/DocxExtractor.js";
import { extractPdfAsText, PdfExtractError } from "./extractors/PdfExtractor.js";
import { extractXlsxAsText, XlsxExtractError } from "./extractors/XlsxExtractor.js";
import { extractHtmlTextPreserveLines } from "./html/HtmlTextExtractor.js";
import type { DocumentKind } from "../types.js";

export type DocumentSourceFormat =
    | "md"
    | "mdx"
    | "html"
    | "css"
    | "text"
    | "docx"
    | "pdf"
    | "xlsx"
    | "csv"
    | "json"
    | "ndjson"
    | "unknown";

export type DocumentExtractionLimits = {
    maxFileBytes?: number;
    sampleHeadBytes?: number;
    sampleTailBytes?: number;
    maxTimeMs?: number;
    maxChars?: number;
};

export type DocumentExtractionResult = {
    filePath: string;
    sourceFormat: DocumentSourceFormat;
    kind: DocumentKind;
    profileContent: string;
    contentForSearch: string;
    extractor?: string;
    degraded: boolean;
    reasons: string[];
    warnings: string[];
    stats: Record<string, unknown>;
};

const WELL_KNOWN_TEXT_FILES = new Set<string>([
    "README",
    "LICENSE",
    "NOTICE",
    "CHANGELOG",
    "CODEOWNERS",
    ".gitignore",
    ".mcpignore",
    ".editorconfig"
]);

const DEFAULT_MAX_FILE_BYTES = 2_000_000;
const DEFAULT_SAMPLE_HEAD_BYTES = 600_000;
const DEFAULT_SAMPLE_TAIL_BYTES = 300_000;

const WARNING_REASON_MAP: Record<string, string> = {
    pdf_needs_ocr: "document_needs_ocr",
    pdf_page_cap: "document_cap_applied",
    pdf_char_cap: "document_cap_applied",
    pdf_low_text_density: "document_low_quality",
    pdf_empty_page: "document_low_quality",
    xlsx_row_cap: "document_cap_applied",
    xlsx_col_cap: "document_cap_applied",
    xlsx_sheet_cap: "document_cap_applied",
    xlsx_empty_workbook: "document_low_quality",
    xlsx_empty_sheet: "document_low_quality",
    docx_embedded_images_ignored: "document_low_quality"
};

const ERROR_REASON_MAP: Record<string, string> = {
    pdf_parser_missing: "document_parser_missing",
    pdf_read_failed: "document_extract_failed",
    pdf_parse_failed: "document_extract_failed",
    xlsx_parser_missing: "document_parser_missing",
    xlsx_read_failed: "document_extract_failed",
    xlsx_parse_failed: "document_extract_failed",
    docx_parser_missing: "document_parser_missing",
    docx_read_failed: "document_extract_failed",
    docx_parse_failed: "document_extract_failed"
};

export class DocumentContentLoader {
    constructor(private readonly rootPath: string, private readonly fileSystem: IFileSystem) {}

    public async loadForIndex(
        filePath: string,
        sizeBytes: number,
        limits?: DocumentExtractionLimits
    ): Promise<DocumentExtractionResult> {
        return this.load(filePath, sizeBytes, limits);
    }

    public async loadForTool(
        filePath: string,
        limits?: DocumentExtractionLimits
    ): Promise<DocumentExtractionResult> {
        const stats = await this.fileSystem.stat(filePath);
        return this.load(filePath, stats.size, limits);
    }

    private async load(
        filePath: string,
        sizeBytes: number,
        limits?: DocumentExtractionLimits
    ): Promise<DocumentExtractionResult> {
        const sourceFormat = inferSourceFormat(filePath);
        const kind = inferDocumentKind(filePath, sourceFormat);
        const warnings: string[] = [];
        const reasons: string[] = [];
        const stats: Record<string, unknown> = {};
        let profileContent = "";
        let contentForSearch = "";
        let extractor: string | undefined;

        const maxTimeMs = typeof limits?.maxTimeMs === "number" ? limits.maxTimeMs : undefined;
        const startedAt = Date.now();

        try {
            if (sourceFormat === "docx") {
                const absPath = this.resolveAbsolutePath(filePath);
                extractor = "mammoth";
                const extracted = await withTimeout(extractDocxAsHtml(absPath), maxTimeMs);
                warnings.push(...extracted.warnings);
                stats.inputBytes = extracted.stats?.inputBytes;
                stats.outputChars = extracted.stats?.outputChars;
                profileContent = extracted.html ?? "";
                contentForSearch = extractHtmlTextPreserveLines(profileContent);
            } else if (sourceFormat === "pdf") {
                const absPath = this.resolveAbsolutePath(filePath);
                extractor = "pdfjs";
                const extracted = await withTimeout(extractPdfAsText(absPath), maxTimeMs);
                warnings.push(...extracted.warnings);
                stats.inputBytes = extracted.stats?.inputBytes;
                stats.outputChars = extracted.stats?.outputChars;
                stats.extractedPages = extracted.stats?.extractedPages;
                stats.samplingApplied = extracted.stats?.samplingApplied;
                profileContent = normalizePdfMarkers(extracted.text ?? "");
                contentForSearch = profileContent;
            } else if (sourceFormat === "xlsx") {
                const absPath = this.resolveAbsolutePath(filePath);
                extractor = "xlsx";
                const extracted = await withTimeout(extractXlsxAsText(absPath), maxTimeMs);
                warnings.push(...extracted.warnings);
                stats.inputBytes = extracted.stats?.inputBytes;
                stats.outputChars = extracted.stats?.outputChars;
                stats.totalSheets = extracted.stats?.totalSheets;
                stats.extractedSheets = extracted.stats?.extractedSheets;
                stats.samplingApplied = extracted.stats?.samplingApplied;
                profileContent = normalizeXlsxMarkers(extracted.text ?? "");
                contentForSearch = profileContent;
            } else {
                const sampled = await withTimeout(this.readTextWithSampling(filePath, sizeBytes, limits), maxTimeMs);
                profileContent = sampled.content;
                contentForSearch = profileContent;
                if (sampled.samplingApplied) {
                    warnings.push("document_sampled");
                    reasons.push("document_sampled");
                }
                stats.inputBytes = sampled.inputBytes;
                stats.outputChars = profileContent.length;
                stats.samplingApplied = sampled.samplingApplied;
            }
        } catch (error: any) {
            const errorReason = error?.reason as string | undefined;
            if (errorReason === "budget_exceeded") {
                warnings.push("document_timebox_exceeded");
                reasons.push("budget_exceeded");
            } else if (errorReason) {
                warnings.push(errorReason);
                const mapped = ERROR_REASON_MAP[errorReason];
                if (mapped) {
                    reasons.push(mapped);
                } else {
                    reasons.push("document_extract_failed");
                }
            } else {
                reasons.push("document_extract_failed");
            }
        }

        for (const warning of warnings) {
            const mapped = WARNING_REASON_MAP[warning];
            if (mapped) reasons.push(mapped);
        }

        const normalizedWarnings = Array.from(new Set(warnings.filter(Boolean)));
        const normalizedReasons = Array.from(new Set(reasons.filter(Boolean)));

        const degraded = normalizedReasons.length > 0;
        return {
            filePath,
            sourceFormat,
            kind,
            profileContent,
            contentForSearch,
            extractor,
            degraded,
            reasons: normalizedReasons,
            warnings: normalizedWarnings,
            stats: {
                ...stats,
                elapsedMs: Date.now() - startedAt
            }
        };
    }

    private resolveAbsolutePath(filePath: string): string {
        return path.isAbsolute(filePath) ? filePath : path.resolve(this.rootPath, filePath);
    }

    private async readTextWithSampling(
        filePath: string,
        sizeBytes: number,
        limits?: DocumentExtractionLimits
    ): Promise<{ content: string; samplingApplied: boolean; inputBytes: number }> {
        const maxBytes = resolveLimit(limits?.maxFileBytes, process.env.KAIRO_DOC_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES);
        const headBytes = resolveLimit(limits?.sampleHeadBytes, process.env.KAIRO_DOC_SAMPLE_HEAD_BYTES, DEFAULT_SAMPLE_HEAD_BYTES);
        const tailBytes = resolveLimit(limits?.sampleTailBytes, process.env.KAIRO_DOC_SAMPLE_TAIL_BYTES, DEFAULT_SAMPLE_TAIL_BYTES);

        if (Number.isFinite(maxBytes) && maxBytes > 0 && sizeBytes > maxBytes) {
            const content = await this.readSampledUtf8(filePath, Math.max(1, headBytes), Math.max(0, tailBytes), sizeBytes);
            return { content, samplingApplied: true, inputBytes: sizeBytes };
        }
        const content = await this.fileSystem.readFile(filePath);
        return { content, samplingApplied: false, inputBytes: sizeBytes };
    }

    private async readSampledUtf8(
        filePath: string,
        headBytes: number,
        tailBytes: number,
        sizeBytes?: number
    ): Promise<string> {
        try {
            const absPath = this.resolveAbsolutePath(filePath);
            const handle = await fs.promises.open(absPath, "r");
            try {
                const stat = await handle.stat();
                const size = sizeBytes ?? stat.size;
                const headLen = Math.min(headBytes, size);
                const tailLen = Math.min(tailBytes, Math.max(0, size - headLen));

                const head = Buffer.alloc(headLen);
                await handle.read(head, 0, headLen, 0);

                let tailText = "";
                if (tailLen > 0) {
                    const tail = Buffer.alloc(tailLen);
                    await handle.read(tail, 0, tailLen, size - tailLen);
                    tailText = tail.toString("utf8");
                }

                const marker = `\n[[sampling_applied bytes=${size} head=${headLen} tail=${tailLen}]]\n`;
                return `${head.toString("utf8")}${marker}${tailText}`;
            } finally {
                await handle.close();
            }
        } catch {
            const full = await this.fileSystem.readFile(filePath);
            const marker = `\n[[sampling_applied]]\n`;
            if (full.length <= headBytes + tailBytes) return full;
            const head = full.slice(0, headBytes);
            const tail = tailBytes > 0 ? full.slice(-tailBytes) : "";
            return `${head}${marker}${tail}`;
        }
    }
}

function inferSourceFormat(filePath: string): DocumentSourceFormat {
    const base = path.basename(filePath);
    if (WELL_KNOWN_TEXT_FILES.has(base)) return "text";
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case ".md":
            return "md";
        case ".mdx":
            return "mdx";
        case ".html":
        case ".htm":
            return "html";
        case ".css":
            return "css";
        case ".txt":
        case ".log":
            return "text";
        case ".csv":
            return "csv";
        case ".json":
            return "json";
        case ".ndjson":
            return "ndjson";
        case ".docx":
            return "docx";
        case ".pdf":
            return "pdf";
        case ".xlsx":
            return "xlsx";
        default:
            return "unknown";
    }
}

function inferDocumentKind(filePath: string, sourceFormat: DocumentSourceFormat): DocumentKind {
    if (sourceFormat === "md") return "markdown";
    if (sourceFormat === "mdx") return "mdx";
    if (sourceFormat === "html") return "html";
    if (sourceFormat === "css") return "css";
    if (sourceFormat === "docx") return "html";
    if (sourceFormat === "pdf") return "text";
    if (sourceFormat === "xlsx") return "text";
    if (sourceFormat === "csv") return "text";
    if (sourceFormat === "json") return "text";
    if (sourceFormat === "ndjson") return "text";
    if (sourceFormat === "text") return "text";
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".log") return "text";
    return "unknown";
}

export function normalizePdfMarkers(text: string): string {
    return text.replace(/^\[\[page:(\d+)\]\]$/gm, (_match, page) => `# Page ${page}`);
}

export function normalizeXlsxMarkers(text: string): string {
    return text.replace(/^\[Sheet:\s*(.+?)\]$/gm, (_match, name) => `# Sheet: ${name}`);
}

function resolveLimit(explicit: number | undefined, envValue: string | undefined, fallback: number): number {
    if (Number.isFinite(explicit)) {
        return Math.max(0, Math.floor(explicit as number));
    }
    const parsed = Number.parseInt(envValue ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return fallback;
}

async function withTimeout<T>(promise: Promise<T>, maxTimeMs?: number): Promise<T> {
    if (!Number.isFinite(maxTimeMs) || (maxTimeMs as number) <= 0) {
        return promise;
    }
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
            reject({ reason: "budget_exceeded", message: "document_timebox_exceeded" });
        }, maxTimeMs as number);
        timeoutHandle.unref?.();
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}
