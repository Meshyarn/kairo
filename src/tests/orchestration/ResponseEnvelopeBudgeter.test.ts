import { describe, it, expect } from "@jest/globals";
import {
  enforceChangeResponseBudget,
  enforceManageResponseBudget,
  enforceTaskResponseBudget,
  enforceWriteResponseBudget
} from "../../orchestration/budget/ResponseEnvelopeBudgeter.js";

describe("ResponseEnvelopeBudgeter", () => {
  it("compacts change responses when budget is exceeded", () => {
    const response: any = {
      success: true,
      diff: "x".repeat(5000),
      draftPack: {
        id: "draft_1",
        intent: "update",
        status: "pending",
        createdAt: Date.now(),
        preflightCheck: { syntaxValid: true, typesResolvable: true, guardrailsPassed: true, warnings: [] },
        skeleton: { content: "y".repeat(2000), signatures: [] },
        phantomFiles: [{ path: "src/app.ts", content: "z".repeat(4000), isNew: false, language: "ts" }]
      }
    };

    const result = enforceChangeResponseBudget({ response, maxTokens: 1 });

    expect(result.applied).toBe(true);
    expect(response.degraded).toBe(true);
    expect(response.degradedReasons?.some((reason: any) => reason.type === "budget_exceeded")).toBe(true);
    expect(response.draftPack?.phantomFiles).toBeUndefined();
    expect(response.stats?.responseBudget?.applied).toBe(true);
  });

  it("compacts write responses when budget is exceeded", () => {
    const response: any = {
      success: true,
      draftPack: {
        id: "draft_2",
        intent: "write",
        status: "pending",
        createdAt: Date.now(),
        preflightCheck: { syntaxValid: true, typesResolvable: true, guardrailsPassed: true, warnings: [] },
        phantomFiles: [{ path: "src/new.ts", content: "a".repeat(4000), isNew: true, language: "ts" }]
      },
      review: {
        id: "review_1",
        verdict: "pass",
        reviewedAt: Date.now(),
        reviewedFiles: ["src/new.ts"],
        suggestedActions: []
      }
    };

    const result = enforceWriteResponseBudget({ response, maxTokens: 1 });

    expect(result.applied).toBe(true);
    expect(response.degraded).toBe(true);
    expect(response.degradedReasons?.some((reason: any) => reason.type === "budget_exceeded")).toBe(true);
    expect(response.draftPack?.phantomFiles).toBeUndefined();
  });

  it("compacts manage artifacts when budget is exceeded", () => {
    const response: any = {
      success: true,
      result: {
        success: true,
        output: "Artifact retrieved.",
        artifact: {
          id: "draft_3",
          type: "draft",
          createdAt: Date.now(),
          pack: {
            id: "draft_3",
            intent: "update",
            status: "pending",
            createdAt: Date.now(),
            preflightCheck: { syntaxValid: true, typesResolvable: true, guardrailsPassed: true, warnings: [] },
            phantomFiles: [{ path: "src/file.ts", content: "b".repeat(4000), isNew: false, language: "ts" }]
          }
        }
      }
    };

    const result = enforceManageResponseBudget({ response, maxTokens: 1 });

    expect(result.applied).toBe(true);
    expect(response.degraded).toBe(true);
    expect(response.result?.artifact?.pack?.phantomFiles).toBeUndefined();
  });

  it("keeps at least one evidence item with excerpt when task budget is exceeded", () => {
    const response: any = {
      ok: true,
      status: "success",
      summary: { title: "Result", bullets: ["x".repeat(5000)] },
      details: { payload: "y".repeat(12000) },
      decisionTrace: { events: [{ code: "trace", data: "z".repeat(5000) }] },
      evidence: [
        { filePath: "src/a.ts", excerpt: "a".repeat(1000) },
        { filePath: "src/b.ts", excerpt: "b".repeat(1000) }
      ]
    };

    const result = enforceTaskResponseBudget({
      response,
      maxTokens: 1,
      minEvidenceItems: 2,
      minExcerptChars: 400
    });

    expect(result.applied).toBe(true);
    expect(Array.isArray(response.evidence)).toBe(true);
    expect(response.evidence.length).toBeGreaterThanOrEqual(1);
    expect(response.evidence[0]?.filePath).toBeTruthy();
    expect(typeof response.evidence[0]?.excerpt).toBe("string");
  });
});
