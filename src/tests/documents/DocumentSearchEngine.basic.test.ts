import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import fs from "fs";
import { NodeFileSystem } from "../../platform/FileSystem.js";
import { NativeSearchIndexer } from "../../engine/search/native/NativeSearchIndexer.js";
import { IndexDatabase } from "../../indexing/IndexDatabase.js";
import { DocumentIndexer } from "../../indexing/DocumentIndexer.js";
import { DocumentChunkRepository } from "../../indexing/DocumentChunkRepository.js";
import { EmbeddingRepository } from "../../indexing/EmbeddingRepository.js";
import { EmbeddingProviderFactory } from "../../embeddings/EmbeddingProviderFactory.js";
import { DocumentSearchEngine } from "../../documents/search/DocumentSearchEngine.js";
import { SymbolIndex } from "../../ast/SymbolIndex.js";
import { SkeletonGenerator } from "../../ast/SkeletonGenerator.js";
import { NativeSearchCoreStub } from "../utils/NativeSearchCoreStub.js";
import { createTempDir, cleanupTempDir, setupWorkspace, setupWorkspaceWithCode } from "./DocumentSearchEngineTestUtils.js";

jest.setTimeout(60000);

let tempDir: string;

beforeAll(() => {
  tempDir = createTempDir();
});

afterAll(() => {
  cleanupTempDir(tempDir);
});

describe("DocumentSearchEngine (basic)", () => {
  it("returns section results for markdown queries", async () => {
    const rootDir = setupWorkspace(tempDir);
    const fileSystem = new NodeFileSystem(rootDir);
    const indexDatabase = new IndexDatabase(rootDir);
    const embeddingRepository = new EmbeddingRepository(indexDatabase);
    const nativeCore = new NativeSearchCoreStub();
    const nativeIndexer = new NativeSearchIndexer(nativeCore);
    const documentIndexer = new DocumentIndexer(rootDir, fileSystem, indexDatabase, {
      embeddingRepository,
      nativeSearchIndexer: nativeIndexer
    });
    await documentIndexer.indexFile("docs/guide.md");
    await documentIndexer.indexFile("docs/faq.md");

    const documentSearchEngine = new DocumentSearchEngine(
      documentIndexer,
      new DocumentChunkRepository(indexDatabase),
      embeddingRepository,
      new EmbeddingProviderFactory({
        provider: "local",
        normalize: true,
        local: { model: "hash-test", dims: 64 }
      }),
      rootDir,
      undefined,
      undefined,
      undefined,
      indexDatabase,
      nativeCore
    );

    const response = await documentSearchEngine.search("install", {
      maxResults: 5,
      maxVectorCandidates: 10,
      maxChunksEmbeddedPerRequest: 10,
      includeEvidence: false
    });

    expect(response.results.length).toBeGreaterThan(0);
    expect(response.results[0].filePath).toBe("docs/guide.md");
    expect(response.results[0].scores.bm25).toBeGreaterThan(0);
    expect(response.stats.vectorEnabled).toBe(true);

    indexDatabase.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("caps document candidates using env guardrails", async () => {
    const rootDir = setupWorkspace(tempDir);
    const fileSystem = new NodeFileSystem(rootDir);
    const indexDatabase = new IndexDatabase(rootDir);
    const embeddingRepository = new EmbeddingRepository(indexDatabase);
    const nativeCore = new NativeSearchCoreStub();
    const nativeIndexer = new NativeSearchIndexer(nativeCore);
    const documentIndexer = new DocumentIndexer(rootDir, fileSystem, indexDatabase, {
      embeddingRepository,
      nativeSearchIndexer: nativeIndexer
    });
    await documentIndexer.indexFile("docs/guide.md");
    await documentIndexer.indexFile("docs/faq.md");

    const documentSearchEngine = new DocumentSearchEngine(
      documentIndexer,
      new DocumentChunkRepository(indexDatabase),
      embeddingRepository,
      new EmbeddingProviderFactory({
        provider: "local",
        normalize: true,
        local: { model: "hash-test", dims: 64 }
      }),
      rootDir,
      undefined,
      undefined,
      undefined,
      indexDatabase,
      nativeCore
    );

    const originalMax = process.env.KAIRO_DOC_MAX_CANDIDATES;
    process.env.KAIRO_DOC_MAX_CANDIDATES = "1";

    const response = await documentSearchEngine.search("install", {
      maxResults: 5,
      maxVectorCandidates: 10,
      maxChunksEmbeddedPerRequest: 10,
      includeEvidence: false
    });

    if (originalMax === undefined) {
      delete process.env.KAIRO_DOC_MAX_CANDIDATES;
    } else {
      process.env.KAIRO_DOC_MAX_CANDIDATES = originalMax;
    }

    expect(response.stats.candidateFiles).toBeLessThanOrEqual(1);

    indexDatabase.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("allows disabling vector search via embedding override", async () => {
    const rootDir = setupWorkspace(tempDir);
    const fileSystem = new NodeFileSystem(rootDir);
    const indexDatabase = new IndexDatabase(rootDir);
    const embeddingRepository = new EmbeddingRepository(indexDatabase);
    const nativeCore = new NativeSearchCoreStub();
    const nativeIndexer = new NativeSearchIndexer(nativeCore);
    const documentIndexer = new DocumentIndexer(rootDir, fileSystem, indexDatabase, {
      embeddingRepository,
      nativeSearchIndexer: nativeIndexer
    });
    await documentIndexer.indexFile("docs/guide.md");

    const documentSearchEngine = new DocumentSearchEngine(
      documentIndexer,
      new DocumentChunkRepository(indexDatabase),
      embeddingRepository,
      new EmbeddingProviderFactory({
        provider: "local",
        normalize: true,
        local: { model: "hash-test", dims: 32 }
      }),
      rootDir,
      undefined,
      undefined,
      undefined,
      indexDatabase,
      nativeCore
    );

    const response = await documentSearchEngine.search("install", {
      embedding: { provider: "disabled" },
      maxResults: 3,
      includeEvidence: false
    });

    expect(response.results.length).toBeGreaterThan(0);
    expect(response.stats.vectorEnabled).toBe(false);
    expect(response.provider).toBeNull();

    indexDatabase.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("uses embedding override model when generating vectors", async () => {
    const rootDir = setupWorkspace(tempDir);
    const fileSystem = new NodeFileSystem(rootDir);
    const indexDatabase = new IndexDatabase(rootDir);
    const embeddingRepository = new EmbeddingRepository(indexDatabase);
    const nativeCore = new NativeSearchCoreStub();
    const nativeIndexer = new NativeSearchIndexer(nativeCore);
    const documentIndexer = new DocumentIndexer(rootDir, fileSystem, indexDatabase, {
      embeddingRepository,
      nativeSearchIndexer: nativeIndexer
    });
    await documentIndexer.indexFile("docs/guide.md");

    const chunkRepo = new DocumentChunkRepository(indexDatabase);
    const targetChunk = chunkRepo.listChunksForFile("docs/guide.md")
      .find(chunk => chunk.text.toLowerCase().includes("npm install"));
    expect(targetChunk).toBeTruthy();

    const documentSearchEngine = new DocumentSearchEngine(
      documentIndexer,
      chunkRepo,
      embeddingRepository,
      new EmbeddingProviderFactory({
        provider: "local",
        normalize: true,
        local: { model: "hash-test", dims: 32 }
      }),
      rootDir,
      undefined,
      undefined,
      undefined,
      indexDatabase,
      nativeCore
    );

    await documentSearchEngine.search("npm install", {
      maxResults: 3,
      maxVectorCandidates: 1,
      maxChunksEmbeddedPerRequest: 1,
      includeEvidence: false,
      embedding: {
        provider: "local",
        normalize: false,
        local: { model: "hash-override", dims: 16 }
      }
    });

    const stored = embeddingRepository.getEmbedding(targetChunk!.id, "local", "hash-override");
    expect(stored).toBeTruthy();
    expect(stored?.dims).toBe(16);

    indexDatabase.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("can search code_comment chunks when includeComments is enabled", async () => {
    const rootDir = setupWorkspaceWithCode(tempDir);
    const fileSystem = new NodeFileSystem(rootDir);
    const indexDatabase = new IndexDatabase(rootDir);
    const embeddingRepository = new EmbeddingRepository(indexDatabase);
    const nativeCore = new NativeSearchCoreStub();
    const nativeIndexer = new NativeSearchIndexer(nativeCore);
    const documentIndexer = new DocumentIndexer(rootDir, fileSystem, indexDatabase, {
      embeddingRepository,
      nativeSearchIndexer: nativeIndexer
    });

    await documentIndexer.indexFile("docs/guide.md");

    const skeletonGenerator = new SkeletonGenerator();
    const symbolIndex = new SymbolIndex(rootDir, skeletonGenerator, [], indexDatabase, fileSystem, {
      nativeSearchIndexer: nativeIndexer
    });
    await symbolIndex.getSymbolsForFile("src/widget.ts");

    const documentSearchEngine = new DocumentSearchEngine(
      documentIndexer,
      new DocumentChunkRepository(indexDatabase),
      embeddingRepository,
      new EmbeddingProviderFactory({
        provider: "local",
        normalize: true,
        local: { model: "hash-test", dims: 32 }
      }),
      rootDir,
      symbolIndex,
      undefined,
      undefined,
      indexDatabase,
      nativeCore
    );

    const response = await documentSearchEngine.search("offline install", {
      includeComments: true,
      maxResults: 5,
      maxVectorCandidates: 10,
      maxChunksEmbeddedPerRequest: 10,
      includeEvidence: false
    });

    expect(response.results.some(r => r.filePath === "src/widget.ts")).toBe(true);

    indexDatabase.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
});
