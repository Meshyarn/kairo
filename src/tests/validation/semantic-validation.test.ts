import { afterEach, describe, expect, it } from "@jest/globals";
import { MemoryFileSystem } from "../../platform/FileSystem.js";
import { EditPlanner } from "../../engine/editor/EditPlanning.js";
import { BackupManager } from "../../engine/editor/EditIntegrity.js";
import { EditExecutor } from "../../engine/editor/EditExecution.js";

const ROOT = process.cwd();
const SAMPLE_PATH = "tmp/semantic-validation-sample.ts";
const SAMPLE_CONTENT = [
  "export function greet(name: string) { return name.toUpperCase(); }",
  "export const message = greet('hi');",
  ""
].join("\n");

let originalSemantic: string | undefined;

afterEach(() => {
  if (originalSemantic === undefined) {
    delete process.env.MCP_VALIDATION_SEMANTIC;
  } else {
    process.env.MCP_VALIDATION_SEMANTIC = originalSemantic;
  }
});

describe("Semantic validation", () => {
  it("blocks unknown symbols in error mode", async () => {
    originalSemantic = process.env.MCP_VALIDATION_SEMANTIC;
    process.env.MCP_VALIDATION_SEMANTIC = "error";

    const fileSystem = new MemoryFileSystem(ROOT);
    await fileSystem.writeFile(SAMPLE_PATH, SAMPLE_CONTENT);

    const executor = new EditExecutor({
      rootPath: ROOT,
      fileSystem,
      planner: new EditPlanner(),
      backupManager: new BackupManager(fileSystem)
    });

    const result = await executor.applyEdits(
      SAMPLE_PATH,
      [{ targetString: "greet('hi')", replacementString: "grete('hi')" }],
      false
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("SEMANTIC_VALIDATION_FAILED");
    expect(result.details?.diagnostics?.[0]?.message).toContain("Unknown symbol");
  });

  it("allows edits but reports warnings in warn mode", async () => {
    originalSemantic = process.env.MCP_VALIDATION_SEMANTIC;
    process.env.MCP_VALIDATION_SEMANTIC = "warn";

    const fileSystem = new MemoryFileSystem(ROOT);
    await fileSystem.writeFile(SAMPLE_PATH, SAMPLE_CONTENT);

    const executor = new EditExecutor({
      rootPath: ROOT,
      fileSystem,
      planner: new EditPlanner(),
      backupManager: new BackupManager(fileSystem)
    });

    const result = await executor.applyEdits(
      SAMPLE_PATH,
      [{ targetString: "greet('hi')", replacementString: "grete('hi')" }],
      false
    );

    expect(result.success).toBe(true);
    expect(result.validationSummary?.warnings.length).toBeGreaterThan(0);
  });
});
