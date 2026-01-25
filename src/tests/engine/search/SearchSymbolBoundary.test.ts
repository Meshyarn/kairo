import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { SearchEngine } from "../../../engine/Search.js";
import { NodeFileSystem } from "../../../platform/FileSystem.js";
import { PathManager } from "../../../utils/PathManager.js";
import { NativeSearchCoreStub } from "../../utils/NativeSearchCoreStub.js";

let tempDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-search-"));
    PathManager.setRoot(tempDir);
    fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "src", "foo.ts"), "class Foo {}");
    fs.writeFileSync(path.join(tempDir, "src", "foobar.ts"), "class FooBar {}");
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("SearchEngine symbol intent boundaries", () => {
    it("prefers exact symbol matches for symbol intent queries", async () => {
        const fileSystem = new NodeFileSystem(tempDir);
        const core = new NativeSearchCoreStub();
        const engine = new SearchEngine(tempDir, fileSystem, [], { nativeSearchCore: core, repoId: "default" });
        await indexFile(core, tempDir, fileSystem, "src/foo.ts");
        await indexFile(core, tempDir, fileSystem, "src/foobar.ts");

        const results = await engine.scout({
            query: "class Foo",
            includeGlobs: ["src/**"],
            groupByFile: true,
            deduplicateByContent: true
        });

        expect(results[0]?.filePath).toBe("src/foo.ts");
        await engine.dispose();
    });
});

async function indexFile(core: NativeSearchCoreStub, rootPath: string, fileSystem: NodeFileSystem, relativePath: string) {
    const absPath = path.join(rootPath, relativePath);
    const content = await fileSystem.readFile(absPath);
    core.upsert({
        kind: "code_file",
        repoId: "default",
        path: relativePath,
        content,
        pathDepth: Math.max(0, relativePath.split("/").filter(Boolean).length - 1),
        callgraphRank: 0
    });
}
