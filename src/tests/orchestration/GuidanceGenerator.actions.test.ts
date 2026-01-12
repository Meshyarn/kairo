import { describe, it, expect } from "@jest/globals";
import { GuidanceGenerator } from "../../orchestration/GuidanceGenerator.js";

describe("GuidanceGenerator action surfacing", () => {
  it("converts degradedReasons.action into manage doctor suggestedActions", () => {
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
});
