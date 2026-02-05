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
import { NativeSearchCoreStub } from "../utils/NativeSearchCoreStub.js";
import {
  SAMPLE_DOCX_BASE64,
  buildSamplePdfBuffer,
  buildSampleXlsxBuffer,
  createTempDir,
  cleanupTempDir,
  setupWorkspace,
  setupWorkspaceWithLog,
  setupWorkspaceWithMetrics
} from "./DocumentSearchEngineTestUtils.js";

jest.setTimeout(60000);

let tempDir: string;
let mammothAvailable = true;
let xlsxAvailable = true;
let pdfAvailable = true;

beforeAll(() => {
  tempDir = createTempDir();
});

beforeAll(async () => {
  try {
    await import("mammoth");
  } catch {
    mammothAvailable = false;
  }
});

beforeAll(async () => {
  try {
    await import("xlsx");
  } catch {
    xlsxAvailable = false;
  }
});

beforeAll(async () => {
  try {
    await import("pdfjs-dist/legacy/build/pdf.js");
  } catch {
    pdfAvailable = false;
  }
});

afterAll(() => {
  cleanupTempDir(tempDir);
});

describe("DocumentSearchEngine (filetypes)", () => {
  it("supports output=pack_only (no previews)", async () => {
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
      undefined,
      undefined,
      indexDatabase,
      nativeCore
    );

    const response = await engine.search("install", { output: "pack_only", includeEvidence: true });
    expect(response.results.length).toBeGreaterThan(0);
    expect(response.results[0]?.preview).toBe("");
    if (Array.isArray(response.evidence) && response.evidence.length > 0) {
      expect(response.evidence[0]?.preview).toBe("");
    }

    indexDatabase.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("indexes .log files as text documents", async () => {
    const rootDir = setupWorkspaceWithLog(tempDir);
    const fileSystem = new NodeFileSystem(rootDir);
    const indexDatabase = new IndexDatabase(rootDir);
    const embeddingRepository = new EmbeddingRepository(indexDatabase);
    const nativeCore = new NativeSearchCoreStub();
    const nativeIndexer = new NativeSearchIndexer(nativeCore);
    const documentIndexer = new DocumentIndexer(rootDir, fileSystem, indexDatabase, {
      embeddingRepository,
      nativeSearchIndexer: nativeIndexer
    });
    await documentIndexer.indexFile("logs/app.log");
    const chunkRepo = new DocumentChunkRepository(indexDatabase);
    const logChunks = chunkRepo.listChunksForFile("logs/app.log");
    expect(logChunks.length).toBeGreaterThan(1);
    expect(logChunks.some(chunk => chunk.text.includes("install failed"))).toBe(true);

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
      undefined,
      undefined,
      indexDatabase,
      nativeCore
    );

    const response = await engine.search("install failed", { output: "compact", includeEvidence: false, includeLogs: true });
    const match = response.results.find(r => r.filePath === "logs/app.log");
    expect(match).toBeTruthy();

    indexDatabase.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("boosts metrics files when includeMetrics is enabled", async () => {
    const rootDir = setupWorkspaceWithMetrics(tempDir);
    const fileSystem = new NodeFileSystem(rootDir);
    const indexDatabase = new IndexDatabase(rootDir);
    const embeddingRepository = new EmbeddingRepository(indexDatabase);
    const nativeCore = new NativeSearchCoreStub();
    const nativeIndexer = new NativeSearchIndexer(nativeCore);
    const documentIndexer = new DocumentIndexer(rootDir, fileSystem, indexDatabase, {
      embeddingRepository,
      nativeSearchIndexer: nativeIndexer
    });
    await documentIndexer.indexFile("metrics/latency.csv");
    await documentIndexer.indexFile("docs/latency.md");

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
      undefined,
      undefined,
      indexDatabase,
      nativeCore
    );

    const originalBoost = process.env.KAIRO_METRICS_SCORE_BOOST;
    process.env.KAIRO_METRICS_SCORE_BOOST = "0.5";
    try {
      const response = await engine.search("latency 250", {
        output: "compact",
        includeEvidence: false,
        includeMetrics: true,
        scope: "docs",
        embedding: { provider: "disabled" }
      });
      expect(response.results[0]?.filePath).toBe("metrics/latency.csv");
    } finally {
      if (originalBoost === undefined) {
        delete process.env.KAIRO_METRICS_SCORE_BOOST;
      } else {
        process.env.KAIRO_METRICS_SCORE_BOOST = originalBoost;
      }
    }

    indexDatabase.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("indexes .docx files when parser is available", async () => {
    if (!mammothAvailable) {
      return;
    }
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

    const docxPath = path.join(rootDir, "docs", "sample.docx");
    fs.writeFileSync(docxPath, Buffer.from(SAMPLE_DOCX_BASE64, "base64"));

    await documentIndexer.indexFile("docs/sample.docx");

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
      undefined,
      undefined,
      indexDatabase,
      nativeCore
    );

    const response = await engine.search("Install Guide", { output: "compact", includeEvidence: false });
    const match = response.results.find(r => r.filePath === "docs/sample.docx");
    expect(match).toBeTruthy();

    indexDatabase.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("indexes .xlsx files when parser is available", async () => {
    if (!xlsxAvailable) {
      return;
    }
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

    const xlsxPath = path.join(rootDir, "docs", "errors.xlsx");
    const xlsxBuffer = await buildSampleXlsxBuffer();
    fs.writeFileSync(xlsxPath, xlsxBuffer);

    await documentIndexer.indexFile("docs/errors.xlsx");

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
      undefined,
      undefined,
      indexDatabase,
      nativeCore
    );

    const response = await engine.search("Install failed", { output: "compact", includeEvidence: false });
    const match = response.results.find(r => r.filePath === "docs/errors.xlsx");
    expect(match).toBeTruthy();

    indexDatabase.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("indexes .pdf files when parser is available", async () => {
    if (!pdfAvailable) {
      return;
    }
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

    const pdfPath = path.join(rootDir, "docs", "manual.pdf");
    const pdfBuffer = buildSamplePdfBuffer("Install failed: missing dependency");
    fs.writeFileSync(pdfPath, pdfBuffer);

    await documentIndexer.indexFile("docs/manual.pdf");

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
      undefined,
      undefined,
      indexDatabase,
      nativeCore
    );

    const response = await engine.search("Install failed", { output: "compact", includeEvidence: false });
    const match = response.results.find(r => r.filePath === "docs/manual.pdf");
    expect(match).toBeTruthy();

    indexDatabase.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
});
