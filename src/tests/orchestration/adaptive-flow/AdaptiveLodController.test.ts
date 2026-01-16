import { describe, it, expect } from "@jest/globals";
import { AdaptiveLodController } from "../../../orchestration/adaptive-flow/AdaptiveLodController.js";

describe("AdaptiveLodController", () => {
  it("keeps profile when stable", () => {
    const controller = new AdaptiveLodController({ enabled: true, windowSize: 4, cooldownCalls: 2 });
    const decision = controller.resolveProfile({
      sessionId: "s1",
      tool: "explore",
      requestedProfile: "deep",
      explicit: false
    });
    expect(decision?.profile).toBe("deep");
    expect(decision?.downshifted).toBe(false);
  });

  it("downshifts one step after a single violation", () => {
    const controller = new AdaptiveLodController({ enabled: true, windowSize: 4, cooldownCalls: 2 });
    controller.recordOutcome({
      sessionId: "s1",
      tool: "explore",
      success: true,
      degradedReasons: [{ type: "budget_exceeded" }]
    });
    const decision = controller.resolveProfile({
      sessionId: "s1",
      tool: "explore",
      requestedProfile: "deep",
      explicit: false
    });
    expect(decision?.profile).toBe("balanced");
    expect(decision?.downshifted).toBe(true);
  });

  it("forces lean after consecutive violations", () => {
    const controller = new AdaptiveLodController({ enabled: true, windowSize: 4, cooldownCalls: 2 });
    controller.recordOutcome({
      sessionId: "s1",
      tool: "explore",
      success: false
    });
    controller.recordOutcome({
      sessionId: "s1",
      tool: "explore",
      success: false
    });
    const decision = controller.resolveProfile({
      sessionId: "s1",
      tool: "explore",
      requestedProfile: "balanced",
      explicit: false
    });
    expect(decision?.profile).toBe("lean");
    expect(decision?.forced).toBe(true);
  });

  it("respects explicit profile requests", () => {
    const controller = new AdaptiveLodController({ enabled: true, windowSize: 4, cooldownCalls: 2 });
    controller.recordOutcome({
      sessionId: "s1",
      tool: "explore",
      success: false
    });
    const decision = controller.resolveProfile({
      sessionId: "s1",
      tool: "explore",
      requestedProfile: "deep",
      explicit: true
    });
    expect(decision?.profile).toBe("deep");
    expect(decision?.downshifted).toBe(false);
  });
});
