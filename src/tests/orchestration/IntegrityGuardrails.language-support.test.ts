import { describe, it, expect } from "@jest/globals";
import { evaluateIntegrityGuardrails } from "../../orchestration/guardrails/IntegrityGuardrails.js";


describe("IntegrityGuardrails language support warnings", () => {
  it("emits degraded warning for L2 languages", async () => {
    const result = await evaluateIntegrityGuardrails({
      targetPath: "README.md",
      newContent: "# Title",
      oldContent: "",
      applyMode: false
    });

    expect(result.status).not.toBe("block");
    expect(result.warnings?.some((warning) => warning.type === "language_support_degraded")).toBe(true);
  });
});
