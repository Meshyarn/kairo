import { describe, it, expect, jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { NodeFileSystem } from "../../platform/FileSystem.js";
import {
    analyzeRelationshipRaw
} from "../../handlers/code/CodeAnalysisOps.js";
import {
    executeAnalyzeFile,
    executeReconstructInterface,
    findReferencesRaw,
    listFilesRaw,
    projectStatsRaw,
    statFileRaw
} from "../../handlers/code/CodeProjectOps.js";
import {
    buildSkeletonFallback,
    inferDocumentKind,
    parseLineRanges
} from "../../handlers/code/CodeHandlerUtils.js";

const makeDeps = (rootPath: string) => {
    const fileSystem = new NodeFileSystem(rootPath);
    const resolveRelativePath = (inputPath: string) => {
        const abs = path.isAbsolute(inputPath) ? inputPath : path.join(rootPath, inputPath);
        const rel = path.relative(rootPath, abs);
        return rel.startsWith("..") ? abs : rel.replace(/\\/g, "/");
    };
    const resolveAbsolutePath = (inputPath: string) => path.join(rootPath, resolveRelativePath(inputPath));

    const context = {
        fileSystem,
        rootPath,
        symbolIndex: { search: jest.fn(async () => [{ filePath: "src/file.ts" }]) },
        dependencyGraph: {
            ensureBuilt: jest.fn(async () => undefined),
            getDependencies: jest.fn(async () => [{ from: "src/file.ts", to: "src/dep.ts", type: "import" }]),
            getIndexStatus: jest.fn(async () => ({
                global: { totalFiles: 2, indexedFiles: 2, unresolvedImports: 0, confidence: "high" },
                perFile: { "src/file.ts": { resolved: false, unresolvedImports: ["x"] } }
            }))
        },
        impactAnalyzer: { analyzeImpact: jest.fn(async () => ({ success: true })) },
        callGraphBuilder: {
            analyzeSymbol: jest.fn(async () => ({
                visitedNodes: {
                    node1: {
                        symbolId: "s1",
                        symbolType: "function",
                        filePath: "src/file.ts",
                        symbolName: "MySymbol",
                        callees: [{ fromSymbolId: "s1", toSymbolId: "s2", callType: "call" }],
                        callers: [{ fromSymbolId: "s3", toSymbolId: "s1", callType: "call" }]
                    }
                }
            }))
        },
        dataFlowTracer: {
            traceVariable: jest.fn(async () => ({
                steps: {
                    step1: { id: "step1", stepType: "definition", filePath: "src/file.ts", textSnippet: "target" }
                },
                edges: []
            }))
        },
        typeDependencyTracker: {
            analyzeType: jest.fn(async () => ({
                visitedNodes: {
                    node1: {
                        symbolId: "t1",
                        symbolType: "type_alias",
                        filePath: "src/file.ts",
                        symbolName: "MyType",
                        dependencies: [],
                        parents: []
                    }
                }
            }))
        },
        referenceFinder: {
            findReferences: jest.fn(async () => [{ filePath: "src/file.ts", text: "target" }])
        },
        fallbackResolver: {
            reconstructGhostInterface: jest.fn(async () => ({ name: "Ghost" }))
        }
    };

    return {
        context,
        resolveRelativePath,
        resolveAbsolutePath
    };
};

describe("Code handler ops", () => {
    it("parses line ranges and infers document kinds", () => {
        expect(parseLineRanges("1-3, 5, 8:6")).toEqual([
            { start: 1, end: 3 },
            { start: 5, end: 5 },
            { start: 6, end: 8 }
        ]);

        const short = buildSkeletonFallback("content", "boom");
        expect(short).toContain("Skeleton generation failed: boom");

        const long = buildSkeletonFallback("a".repeat(6001));
        expect(long).toContain("Preview (start)");
        expect(long).toContain("Preview (end)");

        expect(inferDocumentKind("README")).toBe("text");
        expect(inferDocumentKind("notes.mdx")).toBe("mdx");
        expect(inferDocumentKind("report.pdf")).toBe("text");
        expect(inferDocumentKind("code.ts")).toBe("unknown");
    });

    it("handles relationship analysis modes", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-ops-"));
        const deps = makeDeps(tempDir);

        const impact = await analyzeRelationshipRaw(deps as any, {
            target: "src/file.ts",
            mode: "impact",
            targetType: "file"
        });
        expect((impact as any).success).toBe(true);

        const depsResult = await analyzeRelationshipRaw(deps as any, {
            target: "src/file.ts",
            mode: "dependencies"
        });
        expect((depsResult as any).edges).toHaveLength(1);

        const calls = await analyzeRelationshipRaw(deps as any, {
            target: "MySymbol",
            mode: "calls",
            targetType: "symbol",
            contextPath: "src/file.ts"
        });
        expect((calls as any).edges).toHaveLength(2);

        const flow = await analyzeRelationshipRaw(deps as any, {
            target: "MySymbol",
            mode: "data_flow",
            targetType: "symbol",
            contextPath: "src/file.ts"
        });
        expect((flow as any).nodes[0].label).toBe("target");

        const types = await analyzeRelationshipRaw(deps as any, {
            target: "MySymbol",
            mode: "types",
            targetType: "symbol",
            contextPath: "src/file.ts"
        });
        expect((types as any).nodes[0].label).toBe("MyType");

        await expect(analyzeRelationshipRaw(deps as any, { mode: "dependencies" })).rejects.toMatchObject({
            code: "MissingParameter"
        });

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("executes project ops with filesystem integration", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-project-"));
        const deps = makeDeps(tempDir);
        const fileSystem = deps.context.fileSystem as NodeFileSystem;
        await fileSystem.createDir("src");
        await fileSystem.createDir("src/nested");
        await fileSystem.writeFile("src/file.ts", "line1\nline2\n");
        await fileSystem.writeFile("src/nested/other.txt", "hello");

        const analyze = await executeAnalyzeFile(deps as any, { filePath: "src/file.ts" });
        expect(analyze.lineCount).toBe(3);
        expect(analyze.language).toBe("ts");

        const listed = await listFilesRaw(deps as any, { basePath: "src", depth: 1, maxFiles: 10 });
        expect(listed.some(entry => entry.path.endsWith("src/file.ts"))).toBe(true);

        const stats = await statFileRaw(deps as any, { filePath: "src/file.ts" });
        expect(stats.isDirectory).toBe(false);

        const refs = await findReferencesRaw(deps as any, { symbolName: "target", definitionPath: "src/file.ts" });
        expect(refs.success).toBe(true);
        expect(refs.references).toHaveLength(1);

        const ghost = await executeReconstructInterface(deps as any, { symbolName: "Ghost" });
        expect(ghost.success).toBe(true);

        const fallback = await executeReconstructInterface(deps as any, {});
        expect(fallback.success).toBe(false);

        const statsResult = await projectStatsRaw(deps as any);
        expect(statsResult.fileCount).toBeGreaterThan(0);

        fs.rmSync(tempDir, { recursive: true, force: true });
    });
});
