import * as path from "path";
import * as crypto from "crypto";
import ignore from "ignore";
import { IFileSystem } from "../platform/FileSystem.js";
import { IndexDatabase } from "./IndexDatabase.js";
import { DocumentProfiler } from "../documents/DocumentProfiler.js";
import { DocumentChunkRepository, StoredDocumentChunk } from "./DocumentChunkRepository.js";
import { HeadingChunker } from "../documents/chunking/HeadingChunker.js";
import { DocumentKind, DocumentOutlineOptions } from "../types.js";
import { EmbeddingRepository } from "./EmbeddingRepository.js";
import { EmbeddingProviderFactory } from "../embeddings/EmbeddingProviderFactory.js";
import { applyEmbeddingPrefix } from "../embeddings/EmbeddingText.js";
import { VectorIndexManager } from "../vector/VectorIndexManager.js";
import { DocumentContentLoader } from "../documents/DocumentContentLoader.js";
import { hashContent } from "../utils/hash.js";
import { NativeSearchIndexer } from "../engine/search/native/NativeSearchIndexer.js";

const SUPPORTED_DOC_EXTENSIONS = new Set<string>([
    ".md",
    ".mdx",
    ".txt",
    ".log",
    ".html",
    ".htm",
    ".css",
    ".docx",
    ".xlsx",
    ".pdf",
    ".csv",
    ".json",
    ".ndjson"
]);
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

export class DocumentIndexer {
    private ignoreFilter: ReturnType<typeof ignore.default> = (ignore as unknown as () => any)();
    private readonly chunkRepo: DocumentChunkRepository;
    private readonly chunker: HeadingChunker;
    private readonly profiler: DocumentProfiler;
    private readonly contentLoader: DocumentContentLoader;

    constructor(
        private readonly rootPath: string,
        private readonly fileSystem: IFileSystem,
        private readonly indexDatabase: IndexDatabase,
        options?: {
            outlineOptions?: DocumentOutlineOptions;
            embeddingRepository?: EmbeddingRepository;
            embeddingProviderFactory?: EmbeddingProviderFactory;
            vectorIndexManager?: VectorIndexManager;
            nativeSearchIndexer?: NativeSearchIndexer;
            repoId?: string;
        }
    ) {
        this.chunkRepo = new DocumentChunkRepository(indexDatabase);
        this.chunker = new HeadingChunker();
        this.profiler = new DocumentProfiler(rootPath);
        this.contentLoader = new DocumentContentLoader(rootPath, fileSystem);
        this.outlineOptions = options?.outlineOptions ?? {};
        this.embeddingRepository = options?.embeddingRepository;
        this.embeddingProviderFactory = options?.embeddingProviderFactory;
        this.vectorIndexManager = options?.vectorIndexManager;
        this.nativeSearchIndexer = options?.nativeSearchIndexer;
        this.repoId = options?.repoId ?? "default";
    }

    private outlineOptions: DocumentOutlineOptions;
    private readonly embeddingRepository?: EmbeddingRepository;
    private readonly embeddingProviderFactory?: EmbeddingProviderFactory;
    private readonly vectorIndexManager?: VectorIndexManager;
    private readonly nativeSearchIndexer?: NativeSearchIndexer;
    private readonly repoId: string;

    public updateIgnorePatterns(patterns: string[]): void {
        this.ignoreFilter = (ignore as unknown as () => any)().add(patterns ?? []);
    }

    public isSupported(filePath: string): boolean {
        const base = path.basename(filePath);
        if (WELL_KNOWN_TEXT_FILES.has(base)) return true;
        const ext = path.extname(filePath).toLowerCase();
        return SUPPORTED_DOC_EXTENSIONS.has(ext);
    }

    public shouldIgnore(filePath: string): boolean {
        const relPath = this.toRelative(filePath);
        if (!relPath) return true;
        return this.ignoreFilter.ignores(relPath);
    }

    public async indexFile(filePath: string, options: { force?: boolean } = {}): Promise<void> {
        if (!this.isSupported(filePath)) return;
        const relativePath = this.toRelative(filePath);
        if (!relativePath) return;
        if (this.shouldIgnore(relativePath)) return;

        const stats = await this.fileSystem.stat(relativePath);
        const ext = path.extname(relativePath).toLowerCase();
        const isLog = ext === ".log";
        const kind = inferKind(relativePath);
        const existing = this.indexDatabase.getFile(relativePath);
        if (!options.force && existing && existing.last_modified >= stats.mtime && existing.language === kind) {
            return;
        }
        const extracted = await this.contentLoader.loadForIndex(relativePath, stats.size);
        this.indexDatabase.upsertDocumentMeta(relativePath, {
            filePath: relativePath,
            sourceFormat: extracted.sourceFormat,
            extractor: extracted.extractor,
            warnings: extracted.warnings,
            reasons: extracted.reasons,
            stats: extracted.stats,
            updatedAt: Date.now()
        });
        if (!extracted.profileContent) {
            if (extracted.reasons.length > 0) {
                console.warn(`[DocumentIndexer] Failed to extract document (${relativePath}): ${extracted.reasons.join(", ")}`);
            }
            return;
        }
        const contentForChunking = extracted.contentForSearch;

        const fileHash = hashContent(extracted.profileContent ?? extracted.contentForSearch ?? "");
        this.indexDatabase.updateFileMeta(relativePath, {
            lastModified: stats.mtime,
            language: extracted.kind,
            contentHash: fileHash,
            sizeBytes: stats.size
        });
        const previousChunks = this.chunkRepo.listChunksForFile(relativePath);
        if (previousChunks.length > 0) {
            this.vectorIndexManager?.removeChunks(previousChunks.map(chunk => chunk.id));
            this.nativeSearchIndexer?.deleteDocChunks(this.repoId, previousChunks.map(chunk => chunk.id));
        }
        this.embeddingRepository?.deleteEmbeddingsForFile(relativePath);
        let stored: StoredDocumentChunk[];
        if (isLog) {
            stored = this.buildLogChunks(relativePath, contentForChunking);
        } else {
            const profile = await this.profiler.profile({
                filePath: relativePath,
                content: extracted.profileContent,
                kind: extracted.kind,
                options: this.outlineOptions
            });

            const chunks = this.chunker.chunk(relativePath, extracted.kind, profile.outline, contentForChunking, this.outlineOptions);
            stored = chunks.map(chunk => ({
                ...chunk,
                filePath: relativePath
            })) as StoredDocumentChunk[];
        }

        this.chunkRepo.upsertChunksForFile(relativePath, stored);
        this.nativeSearchIndexer?.upsertDocChunks({
            repoId: this.repoId,
            filePath: relativePath,
            chunks: stored
        });
        if (this.shouldEagerEmbed()) {
            await this.embedChunks(stored);
        }
    }

    public deleteFile(filePath: string): void {
        const relativePath = this.toRelative(filePath);
        if (!relativePath) return;
        const previousChunks = this.chunkRepo.listChunksForFile(relativePath);
        if (previousChunks.length > 0) {
            this.vectorIndexManager?.removeChunks(previousChunks.map(chunk => chunk.id));
            this.nativeSearchIndexer?.deleteDocChunks(this.repoId, previousChunks.map(chunk => chunk.id));
        }
        this.chunkRepo.deleteChunksForFile(relativePath);
        this.indexDatabase.deleteFile(relativePath);
    }

    public async rebuildAll(): Promise<void> {
        const files = await this.fileSystem.listFiles(this.rootPath);
        for (const absPath of files) {
            if (!this.isSupported(absPath)) continue;
            if (this.shouldIgnore(absPath)) continue;
            try {
                await this.indexFile(absPath, { force: true });
            } catch {
                // best-effort for now
            }
        }
        this.nativeSearchIndexer?.flush();
    }

    private toRelative(filePath: string): string | null {
        const absolute = path.isAbsolute(filePath)
            ? path.normalize(filePath)
            : path.resolve(this.rootPath, filePath);
        const relative = path.relative(this.rootPath, absolute).replace(/\\/g, "/");
        if (relative.startsWith("..")) {
            return null;
        }
        return relative || ".";
    }

    private shouldEagerEmbed(): boolean {
        return process.env.KAIRO_DOCS_EMBEDDINGS_EAGER === "true";
    }

    private buildLogChunks(filePath: string, content: string): StoredDocumentChunk[] {
        const lines = content.split(/\r?\n/);
        const lineOffsets: number[] = [];
        let offset = 0;
        for (const line of lines) {
            lineOffsets.push(offset);
            offset += line.length + 1;
        }

        const chunks: StoredDocumentChunk[] = [];
        const sectionPath = [path.basename(filePath)];
        const now = Date.now();

        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? "";
            if (!line.trim()) continue;
            const startLine = index + 1;
            const startByte = lineOffsets[index] ?? 0;
            const endByte = startByte + line.length;
            const text = line;
            chunks.push({
                id: this.hash(`${filePath}\nlog\n${startLine}:${startLine}`),
                filePath,
                kind: "text",
                sectionPath,
                heading: null,
                headingLevel: null,
                range: {
                    startLine,
                    endLine: startLine,
                    startByte,
                    endByte
                },
                text,
                contentHash: this.hash(text),
                updatedAt: now
            });
        }

        return chunks;
    }

    private hash(value: string): string {
        return crypto.createHash("sha256").update(value).digest("hex");
    }

    private async embedChunks(chunks: StoredDocumentChunk[]): Promise<void> {
        if (!this.embeddingRepository || !this.embeddingProviderFactory) return;
        if (chunks.length === 0) return;
        const provider = await this.embeddingProviderFactory.getProvider();
        if (provider.provider === "disabled") return;

        const batchSize = this.embeddingProviderFactory.getConfig().batchSize ?? 16;
        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            const batchTexts = batch.map(chunk => chunk.text);
            const prefixed = applyEmbeddingPrefix(batchTexts, "passage", provider.model);
            const vectors = await provider.embed(prefixed);
            for (let idx = 0; idx < batch.length; idx += 1) {
                const chunk = batch[idx];
                const vector = vectors[idx];
                if (!vector) continue;
                if (provider.dims === 0) {
                    provider.dims = vector.length;
                }
                this.embeddingRepository.upsertEmbedding(chunk.id, {
                    provider: provider.provider,
                    model: provider.model,
                    dims: vector.length,
                    vector,
                    norm: l2Norm(vector)
                });
                this.vectorIndexManager?.indexItem({
                    id: chunk.id,
                    metadata: {
                        type: 'doc',
                        filePath: chunk.filePath || '',
                    },
                    embedding: {
                        provider: provider.provider,
                        model: provider.model,
                        dims: vector.length,
                        vector
                    }
                });
            }
        }
    }
}

function inferKind(filePath: string): DocumentKind {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".html" || ext === ".htm") return "html";
    if (ext === ".css") return "css";
    if (ext === ".mdx") return "mdx";
    if (ext === ".md") return "markdown";
    if (ext === ".txt") return "text";
    if (ext === ".log") return "text";
    if (ext === ".csv") return "text";
    if (ext === ".json") return "text";
    if (ext === ".ndjson") return "text";
    if (ext === ".docx") return "html";
    if (ext === ".xlsx") return "text";
    if (ext === ".pdf") return "text";
    const base = path.basename(filePath);
    if (WELL_KNOWN_TEXT_FILES.has(base)) return "text";
    return "unknown";
}

function l2Norm(vector: Float32Array): number {
    let sum = 0;
    for (const v of vector) {
        sum += v * v;
    }
    return Math.sqrt(sum);
}
