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
      "symbol_index_unavailable",
      "cross_repo_scope_mismatch",
      "cross_repo_edit_blocked"
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

  it("supports action tool call metadata", () => {
    const reason: DegradedReason = {
      type: "missing_query_pack",
      message: "Query pack is missing.",
      actionId: "manage.doctor.parity",
      actionToolCall: { tool: "manage", args: { command: "doctor", scope: "parity" } }
    };

    expect(reason.actionId).toBe("manage.doctor.parity");
    expect(reason.actionToolCall?.tool).toBe("manage");
  });
});
