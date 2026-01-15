import { describe, it, expect } from "@jest/globals";
import { OrchestrationContext } from "../../orchestration/OrchestrationContext.js";
import {
  categorizeDocLinks,
  collectDependenciesFromGraph,
  isCodePath,
  isDocumentPath,
  mergeRelatedCode,
  resolveCodeReferences,
  resolveMentionReferences
} from "../../orchestration/pillars/understand/DependencyAnalysis.js";

describe("DependencyAnalysis", () => {
  it("categorizes document links", () => {
    const result = categorizeDocLinks([
      { resolvedPath: "docs/readme.md" },
      { resolvedPath: "src/index.ts" },
      { resolvedPath: "assets/logo.png" },
      { resolvedPath: undefined }
    ]);

    expect(result.docs).toHaveLength(1);
    expect(result.code).toHaveLength(1);
    expect(result.assets).toHaveLength(1);
    expect(result.external).toHaveLength(1);
  });

  it("detects document/code paths", () => {
    expect(isDocumentPath("notes.txt")).toBe(true);
    expect(isDocumentPath("src/main.ts")).toBe(false);
    expect(isCodePath("src/main.ts")).toBe(true);
    expect(isCodePath("README.md")).toBe(false);
  });

  it("resolves code references with verification", async () => {
    const context = new OrchestrationContext();
    const runTool = async (_ctx: OrchestrationContext, _tool: string, args: any) => {
      return {
        results: [{ path: args.query, score: 0.9 }]
      };
    };

    const results = await resolveCodeReferences(
      context,
      [{ resolvedPath: "src/main.ts" }, { resolvedPath: "src/missing.ts" }],
      runTool
    );

    expect(results[0].status).toBe("verified");
    expect(results[1].status).toBe("verified");
  });

  it("resolves mention references and de-duplicates", async () => {
    const context = new OrchestrationContext();
    const runTool = async () => ({ results: [{ path: "src/main.ts", score: 0.8 }] });

    const results = await resolveMentionReferences(
      context,
      [
        { text: "UserService", kind: "symbol", line: 1 },
        { text: "UserService", kind: "symbol", line: 2 }
      ],
      runTool
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("verified");
  });

  it("merges related code entries without duplicates", () => {
    const merged = mergeRelatedCode(
      [{ path: "a.ts" }, { path: "b.ts" }],
      [{ path: "b.ts" }, { path: "c.ts" }]
    );

    expect(merged?.map((item) => item.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("collects dependencies from UCG graph", async () => {
    const primary = {
      dependencies: new Set(["src/dep.ts"]),
      topology: { topLevelSymbols: [{ name: "Foo" }] },
      lod: 1
    };
    const dep = { topology: { topLevelSymbols: [] }, lod: 1 };
    const ucg = {
      ensureLOD: async () => {},
      getNode: (path: string) => (path === "src/main.ts" ? primary : path === "src/dep.ts" ? dep : undefined)
    };

    const dependContext = new OrchestrationContext();
    const result = await collectDependenciesFromGraph(ucg as any, "src/main.ts", dependContext);

    expect(result?.success).toBe(true);
    expect(result?.edges).toHaveLength(1);
    expect(result?.edges[0].to).toBe("src/dep.ts");
  });
});
