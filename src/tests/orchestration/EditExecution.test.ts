import { describe, it, expect } from "@jest/globals";
import {
  formatBatchDiff,
  inferInsertConfig,
  isLikelyFilePath,
  mapEditsToFiles,
  normalizeEdits,
  normalizeOperation,
  resolveBatchImpactLimit
} from "../../orchestration/pillars/change/EditExecution.js";

describe("EditExecution helpers", () => {
  it("normalizes operations", () => {
    expect(normalizeOperation("remove")).toBe("delete");
    expect(normalizeOperation("append")).toBe("insert");
    expect(normalizeOperation("replace")).toBe("replace");
  });

  it("detects likely file paths", () => {
    expect(isLikelyFilePath("src/main.ts")).toBe(true);
    expect(isLikelyFilePath("README.md")).toBe(true);
    expect(isLikelyFilePath("not a path")).toBe(false);
  });

  it("infers insert config", () => {
    const insert = inferInsertConfig("append", { position: "append" }, "target", "value");
    expect(insert.insertMode).toBe("after");

    const at = inferInsertConfig("insert", { lineRange: { start: 3 } }, "", "value");
    expect(at.insertMode).toBe("at");
    expect(at.insertLineRange?.start).toBe(3);
  });

  it("normalizes edits and filters invalid ones", () => {
    const result = normalizeEdits(
      [
        { operation: "replace", targetString: "a", replacementString: "b", filePath: "src/a.ts" },
        { operation: "insert", insertMode: "at", filePath: "src/a.ts" }
      ],
      "src/a.ts"
    );

    expect(result.edits).toHaveLength(1);
    expect(result.invalidEdits).toHaveLength(1);
  });

  it("maps edits to files and handles errors", () => {
    const mapped = mapEditsToFiles({
      targetFiles: ["src/a.ts"],
      rawEdits: [{ targetString: "a" }],
      fallbackTarget: "src/a.ts",
      extractEditFilePath: () => undefined
    });

    expect(mapped.fileEdits?.has("src/a.ts")).toBe(true);

    const error = mapEditsToFiles({
      targetFiles: [],
      rawEdits: [{ targetString: "a" }],
      extractEditFilePath: () => undefined
    });

    expect(error.error?.errorCode).toBe("MULTI_FILE_MAPPING_REQUIRED");
  });

  it("formats batch diff and resolves impact limit", () => {
    expect(formatBatchDiff("src/a.ts", "diff")).toContain("# src/a.ts");
    expect(resolveBatchImpactLimit({ batchImpactLimit: "5" })).toBe(5);
    expect(resolveBatchImpactLimit({})).toBe(0);
  });
});
