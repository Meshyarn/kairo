import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { HnswVectorIndex } from "../../vector/HnswVectorIndex.js";

describe("HnswVectorIndex", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnsw-index-"));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("loads SCVX indexes and supports insert/search/remove", async () => {
        const dir = path.join(tempDir, "index");
        fs.mkdirSync(dir, { recursive: true });
        const indexPath = path.join(dir, "index.bin");
        const idsPath = path.join(dir, "ids.json");
        const header = Buffer.alloc(16);
        header.write("SCVX", 0, "ascii");
        header.writeUInt32LE(1, 4);
        header.writeUInt32LE(2, 8);
        header.writeUInt32LE(0, 12);
        fs.writeFileSync(indexPath, header);
        fs.writeFileSync(idsPath, JSON.stringify([]));

        const index = new HnswVectorIndex({
            dims: 2,
            maxElements: 5,
            m: 4,
            efConstruction: 10,
            efSearch: 8
        });
        await index.load(dir);

        index.upsert("a", new Float32Array([1, 0]));
        index.upsert("b", new Float32Array([0, 1]));

        const results = index.search(new Float32Array([1, 0]), 2);
        expect(results[0]?.id).toBe("a");

        index.remove("a");
        const after = index.search(new Float32Array([1, 0]), 2);
        expect(after.find(result => result.id === "a")).toBeUndefined();
    });

    it("saves and reloads persisted indexes", async () => {
        const dir = path.join(tempDir, "persist");
        fs.mkdirSync(dir, { recursive: true });
        const indexPath = path.join(dir, "index.bin");
        const idsPath = path.join(dir, "ids.json");
        const header = Buffer.alloc(16);
        header.write("SCVX", 0, "ascii");
        header.writeUInt32LE(1, 4);
        header.writeUInt32LE(2, 8);
        header.writeUInt32LE(3, 12);
        const vecBytes = Buffer.alloc(3 * 2 * 4);
        const normBytes = Buffer.alloc(3 * 4);
        const deletedBytes = Buffer.alloc(3);
        const payload = Buffer.concat([header, vecBytes, normBytes, deletedBytes]);
        fs.writeFileSync(indexPath, payload);
        fs.writeFileSync(idsPath, JSON.stringify([]));

        const index = new HnswVectorIndex({
            dims: 2,
            maxElements: 3,
            m: 4,
            efConstruction: 10,
            efSearch: 8
        });
        await index.load(dir);
        index.upsert("x", new Float32Array([1, 0]));
        await index.save(dir);

        const reloaded = new HnswVectorIndex({
            dims: 2,
            maxElements: 3,
            m: 4,
            efConstruction: 10,
            efSearch: 8
        });
        await reloaded.load(dir);
        const results = reloaded.search(new Float32Array([1, 0]), 1);
        expect(results[0]?.id).toBe("x");
        reloaded.dispose();
        index.dispose();
    });
});
