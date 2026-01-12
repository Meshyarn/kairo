import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { IndexDatabase } from "../../indexing/IndexDatabase.js";
import { EvidencePackRepository } from "../../indexing/EvidencePackRepository.js";
import { StorageMaintenanceService } from "../../indexing/StorageMaintenanceService.js";

describe("StorageMaintenanceService", () => {
    const originalStorageMode = process.env.KAIRO_STORAGE_MODE;
    let rootDir = "";

    beforeAll(() => {
        process.env.KAIRO_STORAGE_MODE = "memory";
        rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-prune-"));
    });

    afterAll(() => {
        if (originalStorageMode === undefined) {
            delete process.env.KAIRO_STORAGE_MODE;
        } else {
            process.env.KAIRO_STORAGE_MODE = originalStorageMode;
        }
        if (rootDir && fs.existsSync(rootDir)) {
            fs.rmSync(rootDir, { recursive: true, force: true });
        }
    });

    it("prunes expired evidence packs", async () => {
        const db = new IndexDatabase(rootDir);
        const packs = new EvidencePackRepository(db);
        const now = Date.now();

        packs.upsertPack({
            packId: "pack-expired",
            query: "expired",
            createdAt: now - 1000,
            expiresAt: now - 1,
            rootFingerprint: "root",
            options: {},
            items: []
        });
        packs.upsertPack({
            packId: "pack-active",
            query: "active",
            createdAt: now,
            rootFingerprint: "root",
            options: {},
            items: []
        });

        const service = new StorageMaintenanceService(db);
        const plan = await service.prune({ mode: "plan", targets: ["evidence_packs"] });
        expect(plan.report.evidencePacks?.beforeCount).toBe(2);
        expect(plan.report.evidencePacks?.deleted.expired).toBe(1);

        const applied = await service.prune({ mode: "apply", targets: ["evidence_packs"] });
        expect(applied.report.evidencePacks?.afterCount).toBe(1);
        expect(db.getEvidencePack("pack-expired")).toBeNull();
        expect(db.getEvidencePack("pack-active")).not.toBeNull();
    });

    it("prunes orphaned summaries", async () => {
        const db = new IndexDatabase(rootDir);
        const now = Date.now();

        db.upsertDocumentChunks("docs/a.md", [{
            id: "chunk-1",
            filePath: "docs/a.md",
            kind: "markdown",
            sectionPath: [],
            heading: null,
            headingLevel: null,
            range: { startLine: 1, endLine: 1, startByte: 0, endByte: 10 },
            text: "hello",
            contentHash: "hash-1",
            updatedAt: now
        }]);

        db.upsertChunkSummary("chunk-1", "preview", "ok", "hash-1");
        db.upsertChunkSummary("chunk-orphan", "preview", "orphan", "hash-2");

        const service = new StorageMaintenanceService(db);
        const applied = await service.prune({ mode: "apply", targets: ["chunk_summaries"] });
        expect(applied.report.summaries?.beforeChunks).toBe(2);
        expect(applied.report.summaries?.afterChunks).toBe(1);
        expect(db.getChunkSummary("chunk-orphan", "preview")).toBeNull();
        expect(db.getChunkSummary("chunk-1", "preview")).not.toBeNull();
    });
});
