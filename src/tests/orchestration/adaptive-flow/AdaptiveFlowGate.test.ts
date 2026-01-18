import { describe, it, expect } from "@jest/globals";
import {
  computeAdaptiveFlowGate,
  resolveAdaptiveFlowLOD,
  setAdaptiveFlowGate
} from "../../../orchestration/adaptive-flow/AdaptiveFlowGate.js";
import { OrchestrationContext } from "../../../orchestration/OrchestrationContext.js";

describe("AdaptiveFlowGate", () => {
  it("caps LOD by profile rules", () => {
    const gate = computeAdaptiveFlowGate({ profile: "fast", fileCount: 1200 });
    expect(gate.profileMaxLOD).toBe(1);
    expect(gate.scaleMaxLOD).toBe(3);
    expect(gate.allowedMaxLOD).toBe(1);
    expect(gate.gatedByProfile).toBe(true);
    expect(gate.gatedByScale).toBe(false);
  });

  it("caps LOD by repo scale", () => {
    const gate = computeAdaptiveFlowGate({ profile: "deep", fileCount: 15000 });
    expect(gate.profileMaxLOD).toBe(3);
    expect(gate.scaleMaxLOD).toBe(1);
    expect(gate.allowedMaxLOD).toBe(1);
    expect(gate.gatedByProfile).toBe(false);
    expect(gate.gatedByScale).toBe(true);
  });

  it("applies gate to resolveAdaptiveFlowLOD", () => {
    const context = new OrchestrationContext();
    setAdaptiveFlowGate(context, computeAdaptiveFlowGate({ profile: "balanced", fileCount: 5000 }));
    expect(resolveAdaptiveFlowLOD(context, 3)).toBe(2);
    expect(resolveAdaptiveFlowLOD(context, 1)).toBe(1);
  });
});
