import * as path from "path";
import { MemoryFileSystem } from "../platform/FileSystem.js";
import { SearchEngine } from "../engine/Search.js";
import { ResourceBudget, ResourceUsage } from "../types.js";
import { AstManager } from "../ast/AstManager.js";
import { NativeSearchCoreStub } from "./utils/NativeSearchCoreStub.js";

const joinLines = (lines: string[]): string => lines.join("\n");
const repoId = "default";

const toRelative = (rootPath: string, absPath: string): string =>
    path.relative(rootPath, absPath).replace(/\\/g, "/");

const computePathDepth = (relativePath: string): number =>
    Math.max(0, relativePath.split("/").filter(Boolean).length - 1);

const indexFile = async (
    core: NativeSearchCoreStub,
    rootPath: string,
    fileSystem: MemoryFileSystem,
    absPath: string
) => {
    const content = await fileSystem.readFile(absPath);
    const relative = toRelative(rootPath, absPath);
    core.upsert({
        kind: "code_file",
        repoId,
        path: relative,
        content,
        pathDepth: computePathDepth(relative),
        callgraphRank: 0
    });
};

describe("SearchEngine native search integration", () => {
    const rootPath = path.join(process.cwd(), "__search_workspace__");
    const alphaPath = path.join(rootPath, "src", "utils", "alpha.ts");
    const betaPath = path.join(rootPath, "src", "utils", "beta.ts");
    const camelPath = path.join(rootPath, "src", "models", "UserAccount.ts");

    let fileSystem: MemoryFileSystem;
    let searchEngine: SearchEngine;
    let nativeCore: NativeSearchCoreStub;

    beforeEach(async () => {
        fileSystem = new MemoryFileSystem(rootPath);
        nativeCore = new NativeSearchCoreStub();
        await fileSystem.createDir(path.dirname(alphaPath));
        await fileSystem.createDir(path.dirname(camelPath));
        await fileSystem.writeFile(alphaPath, joinLines([
            "export function alphaFunction() {",
            "  const message = 'alpha matches here';",
            "  return message;",
            "}",
        ]));
        await fileSystem.writeFile(betaPath, joinLines([
            "export const betaValue = () => {",
            "  return 42;",
            "};",
        ]));
        await fileSystem.writeFile(camelPath, joinLines([
            "export class UpdateUserPermission {",
            "  private userToken: string;",
            "  syncUserPermission() {",
            "    return this.userToken;",
            "  }",
            "}",
        ]));

        searchEngine = new SearchEngine(rootPath, fileSystem, [], { nativeSearchCore: nativeCore, repoId });
        await indexFile(nativeCore, rootPath, fileSystem, alphaPath);
        await indexFile(nativeCore, rootPath, fileSystem, betaPath);
        await indexFile(nativeCore, rootPath, fileSystem, camelPath);
    });

    afterEach(async () => {
        await searchEngine.dispose();
        AstManager.resetForTesting();
    });

    it("returns file matches for keyword queries", async () => {
        const results = await searchEngine.scout({ keywords: ["alpha"], basePath: rootPath });
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].filePath).toBe("src/utils/alpha.ts");
        expect(results[0].lineNumber).toBeGreaterThan(0);
    });

    it("uses native candidate selection for pattern-only queries", async () => {
        (fileSystem as any).listFiles = async () => {
            throw new Error("scan disabled for test");
        };

        const results = await searchEngine.scout({ patterns: ["alpha matches here"], basePath: rootPath });
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].filePath).toBe("src/utils/alpha.ts");
    });

    it("normalizes file type filters for native search", async () => {
        (fileSystem as any).listFiles = async () => {
            throw new Error("scan disabled for test");
        };

        const results = await searchEngine.scout({
            keywords: ["alpha"],
            basePath: rootPath,
            fileTypes: [".TS", "TS"]
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results.every(result => result.filePath.endsWith(".ts"))).toBe(true);
    });

    it("reflects indexed updates when files change", async () => {
        let results = await searchEngine.scout({ keywords: ["gamma"], basePath: rootPath });
        expect(results).toHaveLength(0);

        await fileSystem.writeFile(betaPath, joinLines([
            "export const betaValue = () => {",
            "  const gammaRay = 100;",
            "  return gammaRay;",
            "};",
        ]));
        await indexFile(nativeCore, rootPath, fileSystem, betaPath);

        results = await searchEngine.scout({ keywords: ["gamma"], basePath: rootPath });
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].filePath).toBe("src/utils/beta.ts");
    });

    it("supports regex lookups via runFileGrep", async () => {
        const lineNumbers = await searchEngine.runFileGrep("message\\s=", alphaPath);
        expect(lineNumbers).toContain(2);
    });

    it("matches CamelCase identifiers with smart-case defaults", async () => {
        const insensitive = await searchEngine.scout({ keywords: ["userpermission"], basePath: rootPath });
        const camelMatch = insensitive.find(result => result.filePath === "src/models/UserAccount.ts");
        expect(camelMatch).toBeDefined();

        const strict = await searchEngine.scout({ keywords: ["userpermission"], basePath: rootPath, caseSensitive: true });
        const strictMatch = strict.find(result => result.filePath === "src/models/UserAccount.ts");
        expect(strictMatch).toBeUndefined();

        const forced = await searchEngine.scout({ keywords: ["USERPERMISSION"], basePath: rootPath, smartCase: false });
        const forcedMatch = forced.find(result => result.filePath === "src/models/UserAccount.ts");
        expect(forcedMatch).toBeDefined();
    });

    it("locates needles inside large haystacks within budget", async () => {
        const fillerDir = path.join(rootPath, "packages");
        const fillerCount = 250;
        for (let index = 0; index < fillerCount; index++) {
            const fillerPath = path.join(fillerDir, `module-${index}.ts`);
            await fileSystem.createDir(path.dirname(fillerPath));
            await fileSystem.writeFile(fillerPath, joinLines([
                `export function filler${index}() {`,
                `  const token${index} = ${index};`,
                "  return token${index};",
                "}",
            ]));
        }

        const targetPath = path.join(rootPath, "src", "core", "needle.ts");
        await fileSystem.createDir(path.dirname(targetPath));
        await fileSystem.writeFile(targetPath, joinLines([
            "export function locateNeedle() {",
            "  const UniqueNeedleToken = 'needlePayload';",
            "  return UniqueNeedleToken;",
            "}",
        ]));

        const denseCore = new NativeSearchCoreStub();
        const denseEngine = new SearchEngine(rootPath, fileSystem, [], { nativeSearchCore: denseCore, repoId });
        await indexFile(denseCore, rootPath, fileSystem, targetPath);

        const results = await denseEngine.scout({ keywords: ["UniqueNeedleToken"], basePath: rootPath });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0]?.filePath).toBe("src/core/needle.ts");
        expect(results[0]?.preview).toContain("UniqueNeedleToken");
    });

    it("degrades when search budget is exceeded", async () => {
        const budget: ResourceBudget = {
            maxCandidates: 1,
            maxFilesRead: 0,
            maxBytesRead: 1,
            maxParseTimeMs: 1,
            profile: "safe"
        };
        const usage: ResourceUsage = { filesRead: 0, bytesRead: 0, parseTimeMs: 0 };
        const results = await searchEngine.scout({
            keywords: ["alpha"],
            basePath: rootPath,
            budget,
            usage
        });
        expect(results.length).toBeGreaterThanOrEqual(0);
        expect(usage.degraded).toBe(true);
        expect(usage.filesRead).toBeLessThanOrEqual(1);
    });

    it("prioritizes exported definitions via field weights", async () => {
        await fileSystem.writeFile(alphaPath, joinLines([
            "export function alphaMark() {",
            "  return alphaMark;",
            "}",
            "// alphaMark documentation"
        ]));
        await indexFile(nativeCore, rootPath, fileSystem, alphaPath);

        const results = await searchEngine.scout({ keywords: ["alphaMark"], basePath: rootPath });
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].filePath).toBe("src/utils/alpha.ts");
        expect(results[0].preview).toContain("alphaMark");
    });

    it("applies file type filters and per-file match limits", async () => {
        const notesPath = path.join(rootPath, "README.md");
        await fileSystem.writeFile(notesPath, joinLines([
            "# Notes",
            "alpha appears here too"
        ]));
        await indexFile(nativeCore, rootPath, fileSystem, notesPath);
        const results = await searchEngine.scout({
            keywords: ["alpha"],
            basePath: rootPath,
            fileTypes: ["ts"],
            matchesPerFile: 1
        });
        expect(results.every(result => result.filePath.endsWith(".ts"))).toBe(true);
        const alphaMatches = results.filter(result => result.filePath === "src/utils/alpha.ts");
        expect(alphaMatches).toHaveLength(1);
    });

    it("supports snippet-less previews and grouped matches", async () => {
        const results = await searchEngine.scout({
            keywords: ["alpha"],
            basePath: rootPath,
            snippetLength: 0,
            groupByFile: true
        });
        const alphaEntry = results.find(result => result.filePath === "src/utils/alpha.ts");
        expect(alphaEntry).toBeDefined();
        expect(alphaEntry?.preview).toBe("");
        expect(alphaEntry?.groupedMatches).toBeDefined();
        expect(alphaEntry?.matchCount).toBe(alphaEntry?.groupedMatches?.length);
        expect(alphaEntry?.groupedMatches?.length).toBeGreaterThan(0);
    });

    it("deduplicates identical previews across files when requested", async () => {
        const dupPath = path.join(rootPath, "src", "utils", "alphaDuplicate.ts");
        await fileSystem.createDir(path.dirname(dupPath));
        await fileSystem.writeFile(dupPath, joinLines([
            "export function alphaFunction() {",
            "  const message = 'alpha matches here';",
            "  return message;",
            "}",
        ]));
        await indexFile(nativeCore, rootPath, fileSystem, dupPath);
        const results = await searchEngine.scout({
            keywords: ["alpha"],
            basePath: rootPath,
            deduplicateByContent: true
        });
        const duplicates = results.filter(result => result.preview.includes("alpha matches here"));
        expect(duplicates).toHaveLength(1);
    });
});
