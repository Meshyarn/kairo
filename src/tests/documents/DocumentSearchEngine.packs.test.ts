import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import { NodeFileSystem } from "../../platform/FileSystem.js";
import { NativeSearchIndexer } from "../../engine/search/native/NativeSearchIndexer.js";
import { IndexDatabase } from "../../indexing/IndexDatabase.js";
import { DocumentIndexer } from "../../indexing/DocumentIndexer.js";
import { DocumentChunkRepository } from "../../indexing/DocumentChunkRepository.js";
import { EmbeddingRepository } from "../../indexing/EmbeddingRepository.js";
import { EmbeddingProviderFactory } from "../../embeddings/EmbeddingProviderFactory.js";
import { DocumentSearchEngine } from "../../documents/search/DocumentSearchEngine.js";
import { EvidencePackRepository } from "../../indexing/EvidencePackRepository.js";
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

describe("DocumentSearchEngine (packs)", () => {
  it("reuses cached results via packId (in-memory evidence pack)", async () => {
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

    const first = await documentSearchEngine.search("install", {
      output: "compact",
      includeEvidence: false
    });
    expect(first.pack?.packId).toBeTruthy();
    expect(first.pack?.hit).toBe(false);

    const second = await documentSearchEngine.search("install", {
      output: "compact",
      includeEvidence: false,
      packId: first.pack!.packId
    });
    expect(second.pack?.hit).toBe(true);
    expect(second.results).toEqual(first.results);

    indexDatabase.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("reuses persisted results via packId across engine instances (SQLite evidence pack)", async () => {
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

    const packs = new EvidencePackRepository(indexDatabase);

    const engineA = new DocumentSearchEngine(
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
      packs,
      undefined,
      indexDatabase,
      nativeCore
    );

    const first = await engineA.search("install", {
      output: "compact",
      includeEvidence: false
    });
    expect(first.pack?.packId).toBeTruthy();
    expect(first.pack?.hit).toBe(false);

    const engineB = new DocumentSearchEngine(
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
      packs,
      undefined,
      indexDatabase,
      nativeCore
    );

    const second = await engineB.search("install", {
      output: "compact",
      includeEvidence: false,
      packId: first.pack!.packId
    });

    expect(second.pack?.hit).toBe(true);
    expect(second.results).toEqual(first.results);

    indexDatabase.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("stores and reuses chunk preview summaries (chunk_summaries)", async () => {
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

    const packs = new EvidencePackRepository(indexDatabase);
    const chunkRepo = new DocumentChunkRepository(indexDatabase);
    const engine = new DocumentSearchEngine(
      documentIndexer,
      chunkRepo,
      embeddingRepository,
      new EmbeddingProviderFactory({
        provider: "local",
        normalize: true,
        local: { model: "hash-test", dims: 64 }
      }),
      rootDir,
      undefined,
      packs,
      undefined,
      indexDatabase,
      nativeCore
    );

    const first = await engine.search("install", { output: "compact", includeEvidence: false });
    const firstChunkId = first.results[0]?.id;
    expect(firstChunkId).toBeTruthy();
    const firstHash = chunkRepo.getContentHashByChunkId(firstChunkId!);
    expect(firstHash).toBeTruthy();

    const stored = packs.getSummary(firstChunkId!, "preview", firstHash!);
    expect(stored).toBeTruthy();

    const second = await engine.search("install", { output: "compact", includeEvidence: false });
    expect(second.results[0]?.preview).toBeTruthy();

    const guidePath = path.join(rootDir, "docs", "guide.md");
    const beforeText = fs.readFileSync(guidePath, "utf8");
    fs.writeFileSync(guidePath, beforeText.replace("npm install", "npm ci"));
    await documentIndexer.indexFile("docs/guide.md");
    const secondHash = chunkRepo.getContentHashByChunkId(firstChunkId!);
    expect(secondHash).toBeTruthy();
    expect(secondHash).not.toBe(firstHash);

    const stale = packs.getSummary(firstChunkId!, "preview", secondHash!);
    expect(stale).toBeNull();

    const third = await engine.search("install", { output: "compact", includeEvidence: false });
    const refreshedResult = third.results.find(r => r.id === firstChunkId);
    expect(refreshedResult?.preview).toBeTruthy();
    const refreshed = packs.getSummary(firstChunkId!, "preview", secondHash!);
    expect(refreshed).toBeTruthy();

    indexDatabase.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("treats expired packs as cache misses (TTL)", async () => {
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

    const originalTtl = process.env.KAIRO_EVIDENCE_PACK_TTL_MS;
    process.env.KAIRO_EVIDENCE_PACK_TTL_MS = "10";
    const nowSpy = jest.spyOn(Date, "now");
    let now = 1_000_000;
    nowSpy.mockImplementation(() => now);

    const packs = new EvidencePackRepository(indexDatabase);
    const engine = new DocumentSearchEngine(
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
      packs,
      undefined,
      indexDatabase,
      nativeCore
    );

    const first = await engine.search("install", { output: "compact", includeEvidence: false });
    expect(first.pack?.hit).toBe(false);
    expect(first.pack?.packId).toBeTruthy();

    now += 25;
    const second = await engine.search("install", { output: "compact", includeEvidence: false, packId: first.pack!.packId });
    expect(second.pack?.hit).toBe(false);

    nowSpy.mockRestore();
    if (originalTtl === undefined) delete process.env.KAIRO_EVIDENCE_PACK_TTL_MS;
    else process.env.KAIRO_EVIDENCE_PACK_TTL_MS = originalTtl;

    indexDatabase.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("treats stale packs as cache misses when chunk content_hash changes", async () => {
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

    const packs = new EvidencePackRepository(indexDatabase);

    const engineA = new DocumentSearchEngine(
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
      packs,
      undefined,
      indexDatabase,
      nativeCore
    );

    const first = await engineA.search("install", { output: "compact", includeEvidence: false });
    expect(first.pack?.hit).toBe(false);
    const packId = first.pack!.packId;

    const guidePath = path.join(rootDir, "docs", "guide.md");
    const beforeText = fs.readFileSync(guidePath, "utf8");
    fs.writeFileSync(guidePath, beforeText.replace("npm install", "npm ci"));
    await documentIndexer.indexFile("docs/guide.md");

    const engineB = new DocumentSearchEngine(
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
      packs,
      undefined,
      indexDatabase,
      nativeCore
    );

    const second = await engineB.search("install", { output: "compact", includeEvidence: false, packId });
    expect(second.pack?.hit).toBe(false);

    indexDatabase.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
});
