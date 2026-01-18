import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { InternalToolRegistry } from "../../../orchestration/InternalToolRegistry.js";
import { OrchestrationContext } from "../../../orchestration/OrchestrationContext.js";
import { UnderstandPillar } from "../../../orchestration/pillars/UnderstandPillar.js";
import { AstManager } from "../../../ast/AstManager.js";

const buildIntent = (target: string) => ({
  category: "understand",
  action: "analyze",
  targets: [target],
  originalIntent: "Understand fallback",
  constraints: {
    goal: target,
    include: {}
  },
  confidence: 1
});

describe("UnderstandPillar fallbackGraph", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "understand-fallback-"));
    fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
    filePath = path.join(tempDir, "src", "sample.py");
    fs.writeFileSync(filePath, "import os\n\ndef main():\n    return os.getcwd()\n", "utf-8");

    const astManager = AstManager.getInstance();
    await astManager.init({ rootPath: tempDir, mode: "test" });
    const queryProvider = astManager.getQueryProvider();
    const original = queryProvider.getQuery.bind(queryProvider);
    jest.spyOn(queryProvider, "getQuery").mockImplementation(async (lang, languageId, queryName) => {
      if (queryName === "skeleton") {
        return null;
      }
      return original(lang, languageId, queryName);
    });
  });

  afterEach(() => {
    AstManager.resetForTesting();
    jest.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns fallbackGraph when L3 skeleton support is degraded", async () => {
    const registry = new InternalToolRegistry();
    registry.register("project_search", async () => ({
      results: [{ path: filePath }]
    }) as any);
    registry.register("code_read", async () => "import os\n\ndef main():\n    return os.getcwd()\n" as any);
    registry.register("file_profile", async () => ({
      metadata: { lineCount: 3, language: "python" },
      structure: { symbols: [] }
    }) as any);

    const pillar = new UnderstandPillar(registry);
    const result = await pillar.execute(buildIntent(filePath) as any, new OrchestrationContext());

    expect(result.degraded).toBe(true);
    const reason = result.degradedReasons?.find((entry: any) => entry.type === "missing_query_pack");
    expect(reason).toBeDefined();
    expect(reason?.actionId).toBe("manage.doctor.parity");
    expect(reason?.actionToolCall).toMatchObject({ tool: "manage", args: { command: "doctor", scope: "parity" } });
    expect(result.fallbackGraph?.mode).toBe("l2");
    expect(result.fallbackGraph?.edges?.length).toBe(1);
    expect(result.fallbackGraph?.edges?.[0].to).toBe("os");
  });
});
