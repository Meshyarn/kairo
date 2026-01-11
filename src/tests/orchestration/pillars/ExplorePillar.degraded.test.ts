import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { InternalToolRegistry } from "../../../orchestration/InternalToolRegistry.js";
import { OrchestrationContext } from "../../../orchestration/OrchestrationContext.js";
import { ExplorePillar } from "../../../orchestration/pillars/explore/ExplorePillar.js";
import { AstManager } from "../../../ast/AstManager.js";

const makeIntent = (constraints: Record<string, unknown>) => ({
  category: "explore",
  action: "execute",
  targets: [],
  originalIntent: "",
  constraints,
  confidence: 1
});

describe("ExplorePillar degraded blocking", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "explore-degraded-"));
    const srcDir = path.join(tempDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    filePath = path.join(srcDir, "sample.ts");
    fs.writeFileSync(filePath, "export const value = 1;\n", "utf-8");
  });

  afterEach(() => {
    AstManager.resetForTesting();
    jest.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("blocks when L3 query pack is missing", async () => {
    const registry = new InternalToolRegistry();
    registry.register("file_list", async () => ([
      { path: filePath, mtime: 1, size: 24 }
    ]));
    registry.register("code_read", async () => "export const value = 1;");

    const astManager = AstManager.getInstance();
    await astManager.init({ rootPath: tempDir, mode: "test" });
    const queryProvider = astManager.getQueryProvider();
    const original = queryProvider.getQuery.bind(queryProvider);
    jest.spyOn(queryProvider, "getQuery").mockImplementation(async (lang, languageId, queryName) => {
      if (queryName === "imports") {
        return null;
      }
      return original(lang, languageId, queryName);
    });

    const pillar = new ExplorePillar(registry);
    const response = await pillar.execute(
      makeIntent({ paths: [filePath], include: { code: true, docs: false } }) as any,
      new OrchestrationContext()
    );

    expect(response.success).toBe(false);
    expect(response.status).toBe("blocked");
    expect(response.degradedReasons?.some((reason: any) => reason.type === "missing_query_pack")).toBe(true);
  });

  it("blocks when L3 syntax validation fails", async () => {
    fs.writeFileSync(filePath, "function greet(name: string) { if (name { return name; } }\n", "utf-8");

    const registry = new InternalToolRegistry();
    registry.register("file_list", async () => ([
      { path: filePath, mtime: 1, size: 64 }
    ]));
    registry.register("code_read", async () => "function greet(name: string) { if (name { return name; } }");

    const pillar = new ExplorePillar(registry);
    const response = await pillar.execute(
      makeIntent({ paths: [filePath], include: { code: true, docs: false } }) as any,
      new OrchestrationContext()
    );

    expect(response.success).toBe(false);
    expect(response.status).toBe("blocked");
    expect(response.degradedReasons?.some((reason: any) => reason.type === "syntax_validation_failed")).toBe(true);
  });

  it("allows full view even when L3 syntax validation fails", async () => {
    fs.writeFileSync(filePath, "function greet(name: string) { if (name { return name; } }\n", "utf-8");

    const registry = new InternalToolRegistry();
    registry.register("file_list", async () => ([
      { path: filePath, mtime: 1, size: 64 }
    ]));
    registry.register("code_read", async () => "function greet(name: string) { if (name { return name; } }");

    const pillar = new ExplorePillar(registry);
    const response = await pillar.execute(
      makeIntent({ paths: [filePath], include: { code: true, docs: false }, view: "full" }) as any,
      new OrchestrationContext()
    );

    expect(response.success).toBe(true);
    expect(response.status).toBe("ok");
    expect(response.data.code[0]?.kind).toBe("file_full");
  });
});
