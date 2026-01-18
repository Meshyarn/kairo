import type { OrchestrationContext } from "../OrchestrationContext.js";
import type { TraceBuilder } from "../trace/TraceBuilder.js";
import type { LOD_LEVEL } from "../../types/ast.js";

export type AdaptiveFlowProfile = "lean" | "fast" | "balanced" | "deep";

export type AdaptiveFlowGate = {
  profile?: AdaptiveFlowProfile;
  fileCount?: number;
  profileMaxLOD: number;
  scaleMaxLOD: number;
  allowedMaxLOD: number;
  gatedByProfile: boolean;
  gatedByScale: boolean;
};

export type AdaptiveFlowGateTraceContext = {
  rolloutMode?: string;
  userIdResolved?: boolean;
};

export function resolveRolloutPresetFromEnv(): string | undefined {
  const value = process.env.KAIRO_ROLLOUT_MODE ?? process.env.KAIRO_ROLLOUT_PHASE;
  if (!value) return undefined;
  const preset = value.trim().toLowerCase();
  return preset.length > 0 ? preset : undefined;
}

export function computeAdaptiveFlowGate(args: {
  profile?: string | null;
  fileCount?: number;
}): AdaptiveFlowGate {
  const profile = normalizeProfile(args.profile);
  const profileMaxLOD = resolveProfileMaxLOD(profile);
  const scaleMaxLOD = resolveScaleMaxLOD(args.fileCount);
  const allowedMaxLOD = Math.min(profileMaxLOD, scaleMaxLOD);
  return {
    profile,
    fileCount: args.fileCount,
    profileMaxLOD,
    scaleMaxLOD,
    allowedMaxLOD,
    gatedByProfile: profileMaxLOD < 3,
    gatedByScale: scaleMaxLOD < 3
  };
}

export function setAdaptiveFlowGate(context: OrchestrationContext, gate: AdaptiveFlowGate): void {
  context.setState("adaptive_flow_gate", gate);
}

export function getAdaptiveFlowGate(context: OrchestrationContext): AdaptiveFlowGate | undefined {
  return context.getState<AdaptiveFlowGate>("adaptive_flow_gate");
}

export function resolveAdaptiveFlowLOD(context: OrchestrationContext, requestedLOD: LOD_LEVEL): LOD_LEVEL {
  const gate = getAdaptiveFlowGate(context);
  if (!gate) return requestedLOD;
  return Math.min(requestedLOD, gate.allowedMaxLOD) as LOD_LEVEL;
}

export function recordAdaptiveFlowGateTrace(
  traceBuilder: TraceBuilder,
  gate: AdaptiveFlowGate,
  context?: AdaptiveFlowGateTraceContext
): void {
  if (gate.gatedByProfile) {
    traceBuilder.recordEvent({
      area: "policy",
      code: "adaptive_flow.gate.profile",
      data: { profile: gate.profile ?? "balanced", maxLod: gate.profileMaxLOD }
    });
  }
  if (gate.gatedByScale) {
    traceBuilder.recordEvent({
      area: "policy",
      code: "adaptive_flow.gate.scale",
      data: { fileCount: gate.fileCount ?? null, maxLod: gate.scaleMaxLOD }
    });
  }
  if (context?.rolloutMode && (context.rolloutMode === "canary" || context.rolloutMode === "beta")) {
    if (!context.userIdResolved) {
      traceBuilder.recordEvent({
        area: "policy",
        code: "adaptive_flow.rollout.user_missing",
        data: { mode: context.rolloutMode }
      });
    }
  }
}

function normalizeProfile(profile?: string | null): AdaptiveFlowProfile {
  if (profile === "lean" || profile === "fast" || profile === "balanced" || profile === "deep") {
    return profile;
  }
  return "balanced";
}

function resolveProfileMaxLOD(profile: AdaptiveFlowProfile): number {
  if (profile === "lean" || profile === "fast") return 1;
  if (profile === "balanced") return 2;
  return 3;
}

function resolveScaleMaxLOD(fileCount?: number): number {
  if (!Number.isFinite(fileCount)) return 3;
  const count = Math.max(0, fileCount as number);
  if (count > 10000) return 1;
  if (count > 2000) return 2;
  return 3;
}
