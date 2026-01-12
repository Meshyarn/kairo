import { describe, it, expect } from "@jest/globals";
import { GuidanceGenerator } from "../../orchestration/GuidanceGenerator.js";

describe("GuidanceGenerator cross-language contract guidance", () => {
  it("suggests contract verification when degraded contract reasons exist", () => {
    const generator = new GuidanceGenerator();
    const guidance = generator.generate({
      lastPillar: "change",
      lastResult: {
        degraded: true,
        degradedReasons: [
          {
            type: "cross_lang_contract_missing",
            packageName: "@kairo/core-rs",
            message: "Contract manifest is missing.",
            actionToolCall: { tool: "manage", args: { command: "doctor", scope: "contracts" } },
            actionId: "manage.doctor.contracts"
          }
        ]
      },
      insights: []
    });

    const match = guidance.suggestedActions.find(
      (action) => action.id === "manage.doctor.contracts"
    );
    expect(match?.toolCall?.args).toMatchObject({ command: "doctor", scope: "contracts" });
  });
});
