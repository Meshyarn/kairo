import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { MemoryIndexStore, FileIndexStore } from "../../storage/IndexStore.js";
import type { SymbolInfo } from "../../types.js";
import type { StoredDocumentChunk, StoredGhostSymbol, TransactionLogEntry } from "../../storage/index/IndexTypes.js";

const makeSymbol = (name: string): SymbolInfo => ({
    name,
    type: "function",
    range: { startLine: 1, endLine: 1, startByte: 0, endByte: name.length }
});

const makeChunk = (id: string, filePath: string): StoredDocumentChunk => ({
    id,
    filePath,
    kind: "markdown",
    sectionPath: ["Intro"],
    heading: "Intro",
    headingLevel: 1,
    range: { startLine: 1, endLine: 1, startByte: 0, endByte: 10 },
    text: "Hello",
    contentHash: "hash",
    updatedAt: Date.now()
});

const makeTransaction = (id: string, timestamp: number): TransactionLogEntry => ({
    id,
    timestamp,
    status: "pending",
    description: "test",
    snapshots: [
        {
            filePath: "src/a.ts",
            originalContent: "alpha",
            originalHash: "hash-a"
        }
    ]
});

describe("IndexStore", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "index-store-"));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("tracks files, symbols, dependencies, and unresolved entries in memory", () => {
        const store = new MemoryIndexStore(tempDir);

        const absPath = path.join(tempDir, "src", "abs.ts");
        store.getOrCreateFile(absPath, 10, "ts");
        store.getOrCreateFile("src/b.ts", 20, "ts");
        expect(store.getFile("src/abs.ts")?.path).toBe("src/abs.ts");

        store.replaceSymbols({
            relativePath: "src/abs.ts",
            lastModified: 10,
            language: "ts",
            symbols: [makeSymbol("Alpha")]
        });
        const symbolHits = store.searchSymbols("alp");
        expect(symbolHits).toHaveLength(1);

        store.replaceDependencies({
            relativePath: "src/abs.ts",
            lastModified: 10,
            outgoing: [{ targetPath: "src/b.ts", type: "import" }],
            unresolved: [{ specifier: "missing", error: "not found" }]
        });
        expect(store.getDependencies("src/abs.ts", "outgoing")).toHaveLength(1);
        expect(store.getDependencies("src/b.ts", "incoming")).toHaveLength(1);
        expect(store.listUnresolvedForFile("src/abs.ts")).toHaveLength(1);

        store.clearDependencies("src/abs.ts");
        expect(store.countDependencies("src/abs.ts", "outgoing")).toBe(0);

        store.deleteFilesByPrefix("src");
        expect(store.listFiles()).toHaveLength(0);
    });

    it("stores document chunks, embeddings, evidence packs, and summaries in memory", () => {
        const store = new MemoryIndexStore(tempDir);
        const chunk = makeChunk("chunk-1", "docs/a.md");

        store.upsertDocumentChunks("docs/a.md", [chunk]);
        expect(store.listDocumentChunks("docs/a.md")[0]?.id).toBe("chunk-1");
        expect(store.getDocumentChunk("chunk-1")?.filePath).toBe("docs/a.md");
        expect(store.getChunkContentHash("chunk-1")).toBe("hash");
        expect(store.listDocumentFiles(1)).toEqual(["docs/a.md"]);

        const key = { provider: "local", model: "m1" };
        store.upsertEmbedding("chunk-1", key, { dims: 2, vector: new Float32Array([1, 2]) });
        expect(store.getEmbedding("chunk-1", key)?.vector[0]).toBe(1);
        expect(store.listEmbeddings(key, 1)).toHaveLength(1);

        let visited = 0;
        store.iterateEmbeddings(key, () => {
            visited += 1;
        }, { limit: 1 });
        expect(visited).toBe(1);

        store.upsertEvidencePack("pack-1", { ok: true });
        expect(store.getEvidencePack("pack-1")).toEqual({ ok: true });
        store.deleteEvidencePack("pack-1");
        expect(store.getEvidencePack("pack-1")).toBeNull();

        store.upsertChunkSummary("chunk-1", "preview", "summary", "hash");
        expect(store.getChunkSummary("chunk-1", "preview")?.summary).toBe("summary");

        store.deleteEmbeddingsForFile("docs/a.md");
        expect(store.getEmbedding("chunk-1", key)).toBeNull();
        store.deleteDocumentChunks("docs/a.md");
        expect(store.listDocumentChunks("docs/a.md")).toHaveLength(0);
    });

    it("manages ghosts and transactions in memory", () => {
        const store = new MemoryIndexStore(tempDir);

        const ghost: StoredGhostSymbol = {
            name: "Ghost",
            lastSeenPath: "src/ghost.ts",
            type: "function",
            deletedAt: Date.now() - 10000
        };
        store.addGhost(ghost);
        expect(store.findGhost("Ghost")?.name).toBe("Ghost");
        expect(store.listGhosts()).toHaveLength(1);
        store.pruneGhosts(1);
        expect(store.listGhosts()).toHaveLength(0);

        store.addGhost({ ...ghost, deletedAt: Date.now() });
        store.deleteGhost("Ghost");
        expect(store.listGhosts()).toHaveLength(0);

        const t1 = makeTransaction("t1", 1000);
        const t2 = makeTransaction("t2", 500);
        store.upsertPendingTransaction(t1);
        store.upsertPendingTransaction(t2);
        const pending = store.listPendingTransactions();
        expect(pending.map(entry => entry.id)).toEqual(["t2", "t1"]);

        store.markTransactionCommitted("t1", { ...t1, status: "committed" });
        store.markTransactionRolledBack("t2");
        expect(store.listPendingTransactions()).toHaveLength(0);
    });

    it("persists file-backed data and reloads it", () => {
        const store = new FileIndexStore(tempDir);

        store.getOrCreateFile("src/a.ts", 10, "ts");
        store.replaceSymbols({
            relativePath: "src/a.ts",
            lastModified: 10,
            language: "ts",
            symbols: [makeSymbol("Alpha")]
        });
        store.replaceDependencies({
            relativePath: "src/a.ts",
            lastModified: 10,
            outgoing: [{ targetPath: "src/b.ts", type: "import" }],
            unresolved: []
        });

        const chunk = makeChunk("chunk-1", "docs/a.md");
        store.upsertDocumentChunks("docs/a.md", [chunk]);
        const key = { provider: "local", model: "m1" };
        store.upsertEmbedding("chunk-1", key, { dims: 2, vector: new Float32Array([1, 2]) });
        store.upsertEvidencePack("pack-1", { ok: true });
        store.upsertChunkSummary("chunk-1", "preview", "summary", "hash");
        store.upsertPendingTransaction(makeTransaction("t1", 1000));
        store.close();

        const storageDir = path.join(tempDir, ".kairo", "storage");
        expect(fs.existsSync(path.join(storageDir, "files.json"))).toBe(true);
        expect(fs.existsSync(path.join(storageDir, "embeddings.json"))).toBe(true);

        const reopened = new FileIndexStore(tempDir);
        expect(reopened.getFile("src/a.ts")?.language).toBe("ts");
        expect(reopened.readSymbols("src/a.ts")?.[0]?.name).toBe("Alpha");
        expect(reopened.getDependencies("src/a.ts", "outgoing")).toHaveLength(1);
        expect(reopened.listDocumentChunks("docs/a.md")).toHaveLength(1);
        expect(reopened.getEmbedding("chunk-1", key)?.vector[1]).toBe(2);
        expect(reopened.getEvidencePack("pack-1")).toEqual({ ok: true });
        expect(reopened.getChunkSummary("chunk-1", "preview")?.summary).toBe("summary");
        expect(reopened.listPendingTransactions()).toHaveLength(1);
        reopened.close();
    });
});
