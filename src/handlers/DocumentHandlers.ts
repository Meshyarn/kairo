import { BaseHandler } from "./BaseHandler.js";
import { HandlerContext } from "./HandlerContext.js";
import { DocumentKind, DocumentSection } from "../types.js";
import { extractHtmlTextPreserveLines } from "../documents/html/HtmlTextExtractor.js";
import { buildDeterministicPreview, buildDeterministicSummary } from "../documents/summary/DeterministicSummarizer.js";
import { DocumentContentLoader, type DocumentExtractionLimits } from "../documents/DocumentContentLoader.js";
import { buildDegradedReasons } from "../orchestration/DegradedReasonMapper.js";
import * as path from "path";
import * as crypto from "crypto";

export class DocumentHandlers extends BaseHandler {
    private readonly contentLoader: DocumentContentLoader;

    constructor(private context: HandlerContext) {
        super();
        this.contentLoader = new DocumentContentLoader(context.rootPath, context.fileSystem);
    }

    async handle(name: string, args: any): Promise<any> {
        const tools = new Set(['document_references', 'document_search', 'document_toc', 'document_skeleton', 'document_analyze', 'document_section']);
        if (!tools.has(name)) return null;

        const requiredMap: Record<string, string[]> = {
            document_references: ['filePath'],
            document_search: ['query'],
            document_toc: ['filePath'],
            document_skeleton: ['filePath'],
            document_analyze: ['filePath'],
            document_section: ['filePath']
        };
        const missing = this.validateRequiredArgs(name, args, requiredMap);
        if (missing.length > 0) {
            return this.errorResponse("MissingParameter", `Missing required parameter(s): ${missing.join(', ')}`);
        }

        switch (name) {
            case 'document_references':
                return this.jsonResponse(await this.docReferencesRaw(args));
            case 'document_search':
                return this.jsonResponse(await this.docSearchRaw(args));
            case 'document_toc':
                return this.jsonResponse(await this.docTocRaw(args));
            case 'document_skeleton':
                return this.jsonResponse(await this.docSkeletonRaw(args));
            case 'document_analyze':
                return this.jsonResponse(await this.docAnalyzeRaw(args));
            case 'document_section':
                return this.jsonResponse(await this.docSectionRaw(args));
            default:
                break;
        }
        return null;
    }

    private resolveRelativePath(inputPath: string): string {
        return this.context.pathNormalizer.normalize(inputPath);
    }

    private async docTocRaw(args: any) {
        const filePath = this.resolveRelativePath(args.filePath);
        const limits = this.normalizeLimits(args);
        const extracted = await this.contentLoader.loadForTool(filePath, limits);
        const profile = await this.context.documentProfiler.profile({
            filePath,
            content: extracted.profileContent,
            kind: extracted.kind,
            options: args?.options
        });
        const degradation = this.buildDegradation([
            ...(profile.parser?.reason ? [profile.parser.reason] : []),
            ...extracted.reasons
        ], filePath);
        return {
            filePath,
            kind: profile.kind,
            outline: profile.outline,
            sourceFormat: extracted.sourceFormat,
            extractor: extracted.extractor,
            warnings: extracted.warnings,
            stats: extracted.stats,
            ...degradation
        };
    }

    private async docSkeletonRaw(args: any) {
        const filePath = this.resolveRelativePath(args.filePath);
        const limits = this.normalizeLimits(args);
        const extracted = await this.contentLoader.loadForTool(filePath, limits);
        const profile = await this.context.documentProfiler.profile({
            filePath,
            content: extracted.profileContent,
            kind: extracted.kind,
            options: args?.options
        });
        const degradation = this.buildDegradation([
            ...(profile.parser?.reason ? [profile.parser.reason] : []),
            ...extracted.reasons
        ], filePath);
        return {
            filePath,
            kind: profile.kind,
            skeleton: this.context.documentProfiler.buildSkeleton(profile),
            outline: profile.outline,
            sourceFormat: extracted.sourceFormat,
            extractor: extracted.extractor,
            warnings: extracted.warnings,
            stats: extracted.stats,
            ...degradation
        };
    }

    private async docAnalyzeRaw(args: any) {
        const filePath = this.resolveRelativePath(args.filePath);
        const limits = this.normalizeLimits(args);
        const extracted = await this.contentLoader.loadForTool(filePath, limits);
        const profile = await this.context.documentProfiler.profile({
            filePath,
            content: extracted.profileContent,
            kind: extracted.kind,
            options: args?.options
        });
        const degradation = this.buildDegradation([
            ...(profile.parser?.reason ? [profile.parser.reason] : []),
            ...extracted.reasons
        ], filePath);
        return {
            filePath,
            profile,
            skeleton: this.context.documentProfiler.buildSkeleton(profile),
            sourceFormat: extracted.sourceFormat,
            extractor: extracted.extractor,
            warnings: extracted.warnings,
            stats: extracted.stats,
            ...degradation
        };
    }

    private async docReferencesRaw(args: any) {
        const filePath = this.resolveRelativePath(args.filePath);
        const limits = this.normalizeLimits(args);
        const extracted = await this.contentLoader.loadForTool(filePath, limits);
        const profile = await this.context.documentProfiler.profile({
            filePath,
            content: extracted.profileContent,
            kind: extracted.kind,
            options: args?.options
        });
        const links = profile.links ?? [];
        const degradation = this.buildDegradation([
            ...(profile.parser?.reason ? [profile.parser.reason] : []),
            ...extracted.reasons
        ], filePath);
        return {
            filePath,
            kind: profile.kind,
            references: links,
            sourceFormat: extracted.sourceFormat,
            extractor: extracted.extractor,
            warnings: extracted.warnings,
            stats: extracted.stats,
            ...degradation
        };
    }

    private async docSectionRaw(args: any) {
        const filePath = this.resolveRelativePath(args.filePath);
        const limits = this.normalizeLimits(args);
        const extracted = await this.contentLoader.loadForTool(filePath, limits);
        const profile = await this.context.documentProfiler.profile({
            filePath,
            content: extracted.profileContent,
            kind: extracted.kind,
            options: args?.options
        });
        const outline = profile.outline;
        const sectionId = args?.sectionId as string | undefined;
        const headingPath = this.normalizeHeadingPath(args?.headingPath);
        const includeSubsections = args?.includeSubsections === true;
        const mode = (args?.mode ?? "preview") as "summary" | "preview" | "raw";
        const maxChars = limits?.maxChars ?? args?.maxChars ?? 4000;
        const queryHint = typeof args?.query === "string" ? args.query : undefined;
        const reasons: string[] = [...extracted.reasons];
        if (profile.parser?.reason) {
            reasons.push(profile.parser.reason);
        }

        const lines = extracted.profileContent.split(/\r?\n/);
        const wantsWholeDocument = !sectionId && (!headingPath || headingPath.length === 0);
        let section: DocumentSection | undefined;
        let range: { startLine: number; endLine: number };
        let rawSectionContent: string;

        if (wantsWholeDocument || outline.length === 0) {
            range = { startLine: 1, endLine: Math.max(1, lines.length) };
            section = this.buildWholeDocumentSection({
                filePath,
                kind: profile.kind,
                title: profile.title,
                totalLines: range.endLine,
                content: extracted.profileContent
            });
            rawSectionContent = extracted.profileContent;
        } else {
            let sectionIndex = -1;
            if (sectionId) {
                sectionIndex = outline.findIndex(item => item.id === sectionId);
            } else if (headingPath && headingPath.length > 0) {
                sectionIndex = outline.findIndex(item =>
                    this.matchesHeadingPath(item.path, headingPath)
                );
            }

            if (sectionIndex === -1 && headingPath && headingPath.length > 0) {
                const ranked = this.rankSectionsByHeadingPath(outline, headingPath, 5);
                const best = ranked[0];
                if (best && best.score >= 2) {
                    sectionIndex = best.index;
                    reasons.push("closest_match");
                }
            }

            if (sectionIndex === -1) {
                return { success: false, status: 'no_results', message: 'Section not found.' };
            }

            section = outline[sectionIndex];
            range = this.computeSectionRange(outline, sectionIndex, includeSubsections);
            rawSectionContent = lines.slice(range.startLine - 1, range.endLine).join("\n");
        }

        if (!section) {
            return { success: false, status: 'no_results', message: 'Section not found.' };
        }

        const sectionContent = profile.kind === "html"
            ? extractHtmlTextPreserveLines(rawSectionContent)
            : rawSectionContent;

        let contentOut = sectionContent;
        let contentTruncated = false;
        if (mode === "preview") {
            const preview = buildDeterministicPreview({
                text: sectionContent,
                query: queryHint,
                kind: profile.kind,
                maxChars
            });
            contentOut = preview.preview;
            contentTruncated = preview.truncated;
        } else if (mode === "summary") {
            const summary = buildDeterministicSummary({
                text: sectionContent,
                query: queryHint,
                kind: profile.kind,
                maxChars
            });
            contentOut = summary.summary;
            contentTruncated = summary.truncated;
        } else {
            contentOut = sectionContent.slice(0, maxChars);
            contentTruncated = sectionContent.length > maxChars;
        }

        return {
            success: true,
            filePath,
            kind: profile.kind,
            section: {
                ...section,
                range: { ...section.range, startLine: range.startLine, endLine: range.endLine }
            },
            mode,
            truncated: contentTruncated,
            content: contentOut,
            sourceFormat: extracted.sourceFormat,
            extractor: extracted.extractor,
            warnings: extracted.warnings,
            stats: extracted.stats,
            ...this.buildDegradation(reasons, filePath)
        };
    }

    private async docSearchRaw(args: any) {
        const query = args?.query ?? args?.text ?? args?.keywords?.join?.(" ") ?? "";
        return this.context.documentSearchEngine.search(String(query), {
            scope: args?.scope,
            output: args?.output,
            packId: args?.packId,
            maxResults: args?.maxResults ?? args?.limit,
            maxCandidates: args?.maxCandidates,
            maxChunkCandidates: args?.maxChunkCandidates,
            maxVectorCandidates: args?.maxVectorCandidates,
            maxEvidenceSections: args?.maxEvidenceSections,
            maxEvidenceChars: args?.maxEvidenceChars,
            includeEvidence: args?.includeEvidence,
            snippetLength: args?.snippetLength,
            rrfK: args?.rrfK,
            rrfDepth: args?.rrfDepth,
            useMmr: args?.useMmr,
            mmrLambda: args?.mmrLambda,
            maxChunksEmbeddedPerRequest: args?.maxChunksEmbeddedPerRequest,
            maxEmbeddingTimeMs: args?.maxEmbeddingTimeMs,
            embedding: args?.embedding,
            includeComments: args?.includeComments === true,
            includeLogs: args?.includeLogs === true,
            includeMetrics: args?.includeMetrics === true
        });
    }

    private normalizeHeadingPath(raw: any): string[] | null {
        if (!raw) return null;
        if (Array.isArray(raw)) return raw.map(v => String(v));
        if (typeof raw === "string") return raw.split(">").map(p => p.trim()).filter(Boolean);
        return null;
    }

    private buildDegradation(
        reasons: string[],
        filePath: string
    ): { degraded: boolean; reason?: string; reasons?: string[]; degradedReasons?: any } {
        const filtered = Array.from(new Set(reasons.filter(Boolean)));
        if (filtered.length === 0) return { degraded: false };
        return {
            degraded: true,
            reason: filtered[0],
            reasons: filtered.length > 1 ? filtered : undefined,
            degradedReasons: buildDegradedReasons(filtered, { filePath })
        };
    }

    private matchesHeadingPath(candidate: string[], target: string[]): boolean {
        if (candidate.length !== target.length) return false;
        return candidate.every((value, idx) => this.normalizeHeading(value) === this.normalizeHeading(target[idx]));
    }

    private normalizeHeading(value: string): string {
        return value.toLowerCase().replace(/\s+/g, " ").replace(/[#:*_`~]+/g, "").trim();
    }

    private rankSectionsByHeadingPath(outline: Array<{ path: string[] }>, target: string[], limit = 5): Array<{ index: number; score: number }> {
        const scored = outline.map((section, index) => ({
            index,
            score: this.scoreHeadingPath(section.path, target)
        }));
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, Math.max(1, limit));
    }

    private scoreHeadingPath(candidate: string[], target: string[]): number {
        const normalizedCandidate = candidate.map(v => this.normalizeHeading(v)).filter(Boolean);
        const normalizedTarget = target.map(v => this.normalizeHeading(v)).filter(Boolean);
        if (normalizedCandidate.length === 0 || normalizedTarget.length === 0) return 0;
        const minLen = Math.min(normalizedCandidate.length, normalizedTarget.length);
        const maxLen = Math.max(normalizedCandidate.length, normalizedTarget.length);
        let prefixMatches = 0;
        for (let idx = 0; idx < minLen; idx++) {
            if (normalizedCandidate[idx] === normalizedTarget[idx]) prefixMatches++;
            else break;
        }
        return (prefixMatches / maxLen) * 4;
    }

    private computeSectionRange(outline: Array<{ level: number; range: { startLine: number; endLine: number } }>, index: number, includeSubsections: boolean): { startLine: number; endLine: number } {
        const startLine = outline[index].range.startLine;
        if (!includeSubsections) return outline[index].range;
        const level = outline[index].level;
        let endLine = outline[index].range.endLine;
        for (let idx = index + 1; idx < outline.length; idx++) {
            if (outline[idx].level <= level) {
                endLine = outline[idx].range.startLine - 1;
                break;
            }
            endLine = outline[idx].range.endLine;
        }
        return { startLine, endLine };
    }

    private buildWholeDocumentSection(params: { filePath: string; kind: DocumentKind; title?: string; totalLines: number; content: string }): DocumentSection {
        const { filePath, kind, title, totalLines, content } = params;
        const safeTitle = (title && title.trim()) || path.basename(filePath) || filePath;
        const normalizedLines = Math.max(1, totalLines);
        const contentHash = crypto.createHash("sha256").update(content ?? "").digest("hex");
        const documentId = crypto.createHash("sha256").update(`${filePath}:document`).digest("hex");
        return {
            id: documentId,
            filePath,
            kind,
            title: safeTitle,
            level: 0,
            path: [safeTitle],
            range: { startLine: 1, endLine: normalizedLines, startByte: 0, endByte: Buffer.byteLength(content ?? "", "utf-8") },
            contentHash
        };
    }

    private normalizeLimits(args: any): DocumentExtractionLimits | undefined {
        const limits = args?.limits ?? args?.options?.limits;
        if (!limits || typeof limits !== "object") return undefined;
        return {
            maxFileBytes: limits.maxFileBytes,
            sampleHeadBytes: limits.sampleHeadBytes,
            sampleTailBytes: limits.sampleTailBytes,
            maxTimeMs: limits.maxTimeMs,
            maxChars: limits.maxChars
        };
    }
}
