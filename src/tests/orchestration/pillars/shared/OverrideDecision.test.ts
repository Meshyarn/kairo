import { describe, expect, it, jest } from "@jest/globals";
import { evaluateOverrideDecision } from "../../../../orchestration/pillars/shared/OverrideDecision.js";

const buildApproval = () => {
  const issuedAt = new Date(Date.now() - 1000).toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  return {
    approvedBy: "tester",
    reason: "testing",
    issuedAt,
    expiresAt
  };
};

describe("OverrideDecision", () => {
  it("returns blocked response when override is required but missing", async () => {
    const auditLogAppend = jest.fn(async () => "audit-1");
    const result = await evaluateOverrideDecision({
      constraints: { reviewOptions: { blockOn: [] } },
      targetFiles: ["src/app.ts"],
      pillar: "write",
      auditLogAppend
    });

    expect(result.blockedResponse?.errorCode).toBe("OVERRIDE_REQUIRED");
    expect(result.blockedResponse?.blockedReason).toBe("override_required");
    expect(result.trace?.auditEventId).toBe("audit-1");
    expect(result.bypass).toEqual({
      integrityGuardrails: false,
      reviewPolicy: false,
      staleGuard: false
    });
    expect(auditLogAppend).toHaveBeenCalled();
  });

  it("accepts allowed override and returns bypass flags", async () => {
    const auditLogAppend = jest.fn(async () => "audit-2");
    const result = await evaluateOverrideDecision({
      constraints: {
        override: {
          approval: buildApproval(),
          scope: { pillars: ["write"] },
          allow: { staleGuard: { bypass: true } }
        }
      },
      targetFiles: ["src/app.ts"],
      pillar: "write",
      auditLogAppend
    });

    expect(result.decision?.decision).toBe("accepted");
    expect(result.blockedResponse).toBeUndefined();
    expect(result.bypass.staleGuard).toBe(true);
    expect(result.trace?.auditEventId).toBe("audit-2");
    expect(auditLogAppend).toHaveBeenCalled();
  });
});
