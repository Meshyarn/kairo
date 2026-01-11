import { describe, it, expect } from "@jest/globals";
import type { DegradedReason, DegradedReasonType } from "../../types/tool-responses.js";

describe("tool-responses degraded reasons", () => {
  it("accepts expanded degraded reason types", () => {
    const types: DegradedReasonType[] = [
      "budget_exceeded",
      "doc_search_skipped",
      "unsupported_language",
      "missing_query_pack",
      "missing_wasm_grammar",
      "syntax_validation_failed",
      "skeleton_extraction_failed",
      "symbol_index_unavailable"
    ];

    expect(types).toContain("missing_query_pack");
  });

  it("supports language and file metadata fields", () => {
    const reason: DegradedReason = {
      type: "missing_query_pack",
      languageId: "typescript",
      filePath: "src/index.ts",
      message: "Query pack is missing."
    };

    expect(reason.type).toBe("missing_query_pack");
    expect(reason.languageId).toBe("typescript");
  });
});
