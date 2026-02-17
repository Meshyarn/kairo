import { describe, it, expect } from "@jest/globals";
import { GuidanceGenerator } from "../../orchestration/GuidanceGenerator.js";

describe("GuidanceGenerator action surfacing", () => {
  it("converts degradedReasons.actionToolCall into manage doctor suggestedActions", () => {
    const generator = new GuidanceGenerator();
    const guidance = generator.generate({
      lastPillar: "explore",
      lastResult: {
        degraded: true,
        degradedReasons: [
          {
            type: "missing_query_pack",
            message: "Query pack is missing for this language.",
            actionToolCall: { tool: "manage", args: { command: "doctor", scope: "parity" } },
            actionId: "manage.doctor.parity"
          }
        ]
      },
      insights: []
    });

    const match = guidance.suggestedActions.find((action) => action.id === "manage.doctor.parity");
    expect(match?.toolCall?.args).toMatchObject({ command: "doctor", scope: "parity" });
  });

  it("returns up to 5 suggested actions when multiple heuristics are triggered", () => {
    const generator = new GuidanceGenerator();
    const guidance = generator.generate({
      lastPillar: "change",
      lastResult: {
        operation: "plan",
        intent: "Refactor auth checks",
        targetFile: "src/auth.ts",
        degradedReasons: [
          {
            type: "cross_lang_contract_missing",
            actionToolCall: { tool: "manage", args: { command: "doctor", scope: "contracts" } },
            actionId: "manage.doctor.contracts"
          },
          {
            type: "missing_query_pack",
            actionToolCall: { tool: "manage", args: { command: "doctor", scope: "parity" } },
            actionId: "manage.doctor.parity"
          },
          {
            type: "unsupported_language",
            actionToolCall: { tool: "manage", args: { command: "doctor", scope: "languages" } },
            actionId: "manage.doctor.languages"
          }
        ]
      },
      history: [{ tool: "edit_transaction", args: { dryRun: true } }],
      insights: [
        { type: "risk", severity: "high", observation: "impact risk is high", affectedFiles: ["src/auth.ts"] },
        { type: "dependency", severity: "medium", observation: "dependency cycles detected" }
      ]
    });

    expect(guidance.suggestedActions.length).toBe(5);
  });
});
