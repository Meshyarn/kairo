import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { promises as fs } from "fs";
import path from "path";
import { NodeFileSystem } from "../../platform/FileSystem.js";
import { EditPlanner } from "../../engine/editor/EditPlanning.js";
import { BackupManager } from "../../engine/editor/EditIntegrity.js";
import { EditExecutor } from "../../engine/editor/EditExecution.js";

const ROOT = process.cwd();
const TEST_DIR = path.join(ROOT, "tmp", "validation-integration");
const FILE_PATH = path.join("tmp", "validation-integration", "sample.ts");
const BASE_CONTENT = [
  "export function greet(name: string) { return name.toUpperCase(); }",
  "export const message = greet('hi');",
  ""
].join("\n");

jest.setTimeout(60000);

let originalSyntax: string | undefined;
let originalSemantic: string | undefined;

beforeEach(async () => {
  originalSyntax = process.env.MCP_VALIDATION_SYNTAX;
  originalSemantic = process.env.MCP_VALIDATION_SEMANTIC;
  await fs.mkdir(TEST_DIR, { recursive: true });
  await fs.writeFile(path.join(ROOT, FILE_PATH), BASE_CONTENT, "utf-8");
});

afterEach(async () => {
  if (originalSyntax === undefined) {
    delete process.env.MCP_VALIDATION_SYNTAX;
  } else {
    process.env.MCP_VALIDATION_SYNTAX = originalSyntax;
  }
  if (originalSemantic === undefined) {
    delete process.env.MCP_VALIDATION_SEMANTIC;
  } else {
    process.env.MCP_VALIDATION_SEMANTIC = originalSemantic;
  }
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe("Validation integration", () => {
  it("blocks syntax errors when syntax mode is error", async () => {
    process.env.MCP_VALIDATION_SYNTAX = "error";
    process.env.MCP_VALIDATION_SEMANTIC = "off";

    const fileSystem = new NodeFileSystem(ROOT);
    const executor = new EditExecutor({
      rootPath: ROOT,
      fileSystem,
      planner: new EditPlanner(),
      backupManager: new BackupManager(fileSystem)
    });

    const result = await executor.applyEdits(
      FILE_PATH,
      [{ targetString: "return name.toUpperCase();", replacementString: "return name.toUpperCase(" }],
      false
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("SYNTAX_VALIDATION_FAILED");
  });

  it("blocks unknown symbols when semantic mode is error", async () => {
    process.env.MCP_VALIDATION_SYNTAX = "off";
    process.env.MCP_VALIDATION_SEMANTIC = "error";

    const fileSystem = new NodeFileSystem(ROOT);
    const executor = new EditExecutor({
      rootPath: ROOT,
      fileSystem,
      planner: new EditPlanner(),
      backupManager: new BackupManager(fileSystem)
    });

    const result = await executor.applyEdits(
      FILE_PATH,
      [{ targetString: "greet('hi')", replacementString: "grete('hi')" }],
      false
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("SEMANTIC_VALIDATION_FAILED");
  });
});
