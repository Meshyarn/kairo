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
import { NativeSearchCoreStub } from "../utils/NativeSearchCoreStub.js";
import { createTempDir, cleanupTempDir, setupWorkspace } from "./DocumentSearchEngineTestUtils.js";

jest.setTimeout(60000);

let tempDir: string;

beforeAll(() => {
  tempDir = createTempDir();
});

afterAll(() => {
  cleanupTempDir(tempDir);
});

describe("DocumentSearchEngine (degraded)", () => {
  it("marks degraded when evidence is truncated under caps", async () => {
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
      maxResults: 2,
      includeEvidence: true,
      snippetLength: 30,
      maxEvidenceSections: 1,
      maxEvidenceChars: 60,
      maxVectorCandidates: 5,
      maxChunksEmbeddedPerRequest: 5
    });

    expect(response.degraded).toBe(true);
    expect([response.reason, ...(response.reasons ?? [])]).toContain("evidence_truncated");
    expect(response.stats.evidenceTruncated).toBe(true);
    expect((response.evidence ?? []).length).toBeLessThanOrEqual(1);

    indexDatabase.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("marks degraded when embeddings are computed partially", async () => {
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
      maxResults: 3,
      includeEvidence: false,
      maxVectorCandidates: 10,
      maxChunksEmbeddedPerRequest: 1,
      maxEmbeddingTimeMs: 10_000
    });

    expect(response.degraded).toBe(true);
    expect([response.reason, ...(response.reasons ?? [])]).toContain("embedding_partial");

    indexDatabase.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
});
