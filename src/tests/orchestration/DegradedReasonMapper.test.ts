import { describe, it, expect } from "@jest/globals";
import { buildDegradedReasons } from "../../orchestration/DegradedReasonMapper.js";

describe("DegradedReasonMapper", () => {
  it("maps parity reasons to actionToolCall and actionId", () => {
    const reasons = buildDegradedReasons(["missing_query_pack"], {
      languageId: "typescript",
      filePath: "src/index.ts"
    });

    expect(reasons).toHaveLength(1);
    expect(reasons?.[0]).toMatchObject({
      type: "missing_query_pack",
      languageId: "typescript",
      filePath: "src/index.ts",
      actionId: "manage.doctor.parity",
      actionToolCall: { tool: "manage", args: { command: "doctor", scope: "parity" } }
    });
  });

  it("maps contract reasons to actionToolCall and actionId", () => {
    const reasons = buildDegradedReasons(["contract_manifest_missing"], {
      packageName: "@kairo/core-rs"
    });

    expect(reasons?.[0]).toMatchObject({
      type: "cross_lang_contract_missing",
      packageName: "@kairo/core-rs",
      actionId: "manage.doctor.contracts",
      actionToolCall: { tool: "manage", args: { command: "doctor", scope: "contracts" } }
    });
  });

  it("falls back to degraded for unknown reasons", () => {
    const reasons = buildDegradedReasons(["unexpected_reason"]);

    expect(reasons?.[0]).toMatchObject({
      type: "degraded",
      message: "unexpected_reason"
    });
  });

  it("maps native core failures to capability guidance", () => {
    const reasons = buildDegradedReasons(["CAP_NATIVE_SEARCH_UNAVAILABLE"]);

    expect(reasons?.[0]).toMatchObject({
      type: "degraded",
      message: "Native search core is unavailable.",
      actionId: "manage.doctor.capabilities",
      actionToolCall: { tool: "manage", args: { command: "doctor", scope: "capabilities" } }
    });
  });

  it("maps corrupted index to reindex guidance", () => {
    const reasons = buildDegradedReasons(["INDEX_CORRUPTED"]);

    expect(reasons?.[0]).toMatchObject({
      type: "degraded",
      message: expect.stringContaining("reindex"),
      actionId: "manage.reindex",
      actionToolCall: { tool: "manage", args: { command: "reindex" } }
    });
  });
});
