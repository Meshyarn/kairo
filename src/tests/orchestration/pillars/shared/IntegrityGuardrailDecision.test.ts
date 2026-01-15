import { describe, expect, it } from "@jest/globals";
import { evaluateIntegrityGuardrailBlock } from "../../../../orchestration/pillars/shared/IntegrityGuardrailDecision.js";

describe("IntegrityGuardrailDecision", () => {
  it("does not block in dryRun even if guardrails report block", () => {
    const warnings: string[] = [];
    const result = evaluateIntegrityGuardrailBlock({
      guardrailResult: { status: "block" },
      dryRun: true,
      bypass: false,
      workflowWarnings: warnings,
      warningMessage: "warn",
      downgradeOnBypass: true
    });

    expect(result.blocked).toBe(false);
    expect(result.bypassed).toBe(false);
    expect(warnings).toHaveLength(0);
  });

  it("blocks when status=block and bypass is false", () => {
    const result = evaluateIntegrityGuardrailBlock({
      guardrailResult: { status: "block", errorCode: "ARCH" },
      dryRun: false,
      bypass: false
    });

    expect(result.blocked).toBe(true);
    expect(result.bypassed).toBe(false);
    expect(result.guardrailResult.errorCode).toBe("ARCH");
  });

  it("bypasses and downgrades to warn when configured", () => {
    const warnings: string[] = [];
    const result = evaluateIntegrityGuardrailBlock({
      guardrailResult: { status: "block", blockedReason: "architectural_violation" },
      dryRun: false,
      bypass: true,
      workflowWarnings: warnings,
      warningMessage: "Override bypassed integrity guardrails blocking for this apply.",
      downgradeOnBypass: true
    });

    expect(result.blocked).toBe(false);
    expect(result.bypassed).toBe(true);
    expect(result.guardrailResult.status).toBe("warn");
    expect(result.guardrailResult.blockedReason).toBe("override_bypassed");
    expect(warnings).toEqual(["Override bypassed integrity guardrails blocking for this apply."]);
  });
});

