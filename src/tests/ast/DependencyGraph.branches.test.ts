import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { DependencyGraph } from "../../ast/DependencyGraph.js";
import { FeatureFlags } from "../../config/FeatureFlags.js";

describe("DependencyGraph Branches", () => {
  let graph: DependencyGraph;
  let tempDir: string;
  let mocks: any;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dep-graph-test-"));
    
    mocks = {
      symbolIndex: {
        getDatabase: jest.fn().mockReturnValue({
          replaceDependencies: jest.fn(),
          getDependencies: jest.fn().mockReturnValue([]),
          listFiles: jest.fn().mockReturnValue([]),
          listUnresolved: jest.fn().mockReturnValue([]),
          listUnresolvedForFile: jest.fn().mockReturnValue([]),
          countDependencies: jest.fn().mockReturnValue(0),
          deleteFilesByPrefix: jest.fn(),
          clearDependencies: jest.fn(),
          getFile: jest.fn(),
          countFiles: jest.fn().mockReturnValue(0)
        }),
        getAllSymbols: jest.fn().mockImplementation(() => Promise.resolve(new Map())),
        invalidateFile: jest.fn(),
        invalidateDirectory: jest.fn(),
        dropFileFromIndex: jest.fn(),
        dropDirectoryFromIndex: jest.fn()
      },
      resolver: {
        resolveDetailed: jest.fn()
      }
    };

    graph = new DependencyGraph(tempDir, mocks.symbolIndex, mocks.resolver);
    graph.setLoggingEnabled(false);
    (graph as any).lastRebuiltAt = Date.now();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it("covers getIndexStatus confidence levels and age branches", async () => {
    const db = mocks.symbolIndex.getDatabase();
    
    // Branch: totalFiles === 0 -> confidence high
    db.listFiles.mockReturnValue([]);
    const statusEmpty = await graph.getIndexStatus();
    expect(statusEmpty.global.confidence).toBe("high");

    // Branch: low confidence (unresolvedRatio >= 0.25)
    db.listFiles.mockReturnValue(new Array(4).fill({ path: "f.ts" }));
    db.listUnresolved.mockReturnValue(new Array(2).fill({}));
    const statusLow = await graph.getIndexStatus();
    expect(statusLow.global.confidence).toBe("low");

    // Branch: medium confidence via age
    db.listUnresolved.mockReturnValue([]);
    (graph as any).lastRebuiltAt = Date.now() - (2 * 60 * 60 * 1000);
    const statusOld = await graph.getIndexStatus();
    expect(statusOld.global.confidence).toBe("medium");
  });

  it("covers detectMonorepo branches with real files", () => {
    // Case 1: indicator file
    fs.writeFileSync(path.join(tempDir, "lerna.json"), "{}");
    expect((graph as any).detectMonorepo()).toBe(true);
    fs.unlinkSync(path.join(tempDir, "lerna.json"));

    // Case 2: package.json in packages dir
    const pkgDir = path.join(tempDir, "packages", "sub");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "package.json"), "{}");
    expect((graph as any).detectMonorepo()).toBe(true);
  });

  it("covers updateFileDependencies failure branch", async () => {
    // Trigger supportsRegex to enter the read block
    jest.spyOn((graph as any).unifiedExtractor, "supportsRegex").mockReturnValue(true);
    
    // Pass a path that doesn't exist to trigger catch block
    const nonExistent = path.join(tempDir, "ghost.ts");
    await graph.updateFileDependencies(nonExistent);
    
    // Success means it caught the error and didn't crash
    expect(true).toBe(true);
  });
});
