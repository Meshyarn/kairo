import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { InternalToolRegistry } from "../../../orchestration/InternalToolRegistry.js";
import { OrchestrationContext } from "../../../orchestration/OrchestrationContext.js";
import { ChangePillar } from "../../../orchestration/pillars/change/ChangePillar.js";
import { AstManager } from "../../../ast/AstManager.js";

const makeIntent = (constraints: Record<string, unknown>) => ({
  category: "change",
  action: "modify",
  targets: [path.join("src", "sample.ts")],
  originalIntent: "update sample",
  constraints,
  confidence: 1
});

describe("ChangePillar degraded blocking", () => {
  let tempDir: string;
  let cwd: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "change-degraded-"));
    cwd = process.cwd();
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "src", "sample.ts"), "export const value = 1;\n", "utf-8");
  });

  afterEach(() => {
    process.chdir(cwd);
    AstManager.resetForTesting();
    jest.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("blocks when L3 query pack is missing", async () => {
    const registry = new InternalToolRegistry();
    const editCalls: any[] = [];
    registry.register("edit_transaction", async (args: any) => {
      editCalls.push(args);
      return { success: true } as any;
    });

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

    const pillar = new ChangePillar(registry);
    const response = await pillar.execute(
      makeIntent({
        dryRun: true,
        reviewOptions: { preApply: false },
        edits: [{ targetString: "value", replacementString: "value" }]
      }) as any,
      new OrchestrationContext()
    );

    expect(response.status).toBe("blocked");
    expect(response.degradedReasons?.some((reason: any) => reason.type === "missing_query_pack")).toBe(true);
    expect(editCalls.length).toBe(0);
  });

  it("blocks when L3 syntax validation fails", async () => {
    const registry = new InternalToolRegistry();
    const editCalls: any[] = [];
    registry.register("edit_transaction", async (args: any) => {
      editCalls.push(args);
      return {
        success: false,
        message: "Edit would introduce syntax errors.",
        errorCode: "SYNTAX_VALIDATION_FAILED",
        validationSummary: {
          success: false,
          blockingErrors: [
            { filePath: "src/sample.ts", line: 1, column: 1, message: "Syntax error detected." }
          ],
          warnings: [],
          durationMs: 0,
          syntaxChecked: true,
          semanticChecked: false
        }
      } as any;
    });

    const pillar = new ChangePillar(registry);
    const response = await pillar.execute(
      makeIntent({
        dryRun: true,
        reviewOptions: { preApply: false },
        edits: [{ targetString: "value", replacementString: "value" }]
      }) as any,
      new OrchestrationContext()
    );

    expect(response.status).toBe("blocked");
    expect(response.degradedReasons?.some((reason: any) => reason.type === "syntax_validation_failed")).toBe(true);
    expect(editCalls.length).toBe(1);
  });
});
