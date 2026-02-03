import { FeatureFlags } from "../../../config/FeatureFlags.js";
import type { FlowArtifactManager } from "../../flow-artifact-manager.js";
import type { StylePack } from "../../../types/flow-artifacts.js";

export const resolveDryRun = (constraints: any, sessionId?: string): boolean => {
  const raw = constraints?.dryRun;
  if (typeof raw === "boolean") return raw;
  if (sessionId && FeatureFlags.isEnabled(FeatureFlags.WRITERS_FLOW_DEFAULT_DRYRUN)) {
    return true;
  }
  return false;
};

export const resolveReviewOptions = (raw: any, hasSession: boolean): any => {
  const reviewOptions = raw ?? {};
  if (!FeatureFlags.isEnabled(FeatureFlags.WRITERS_FLOW_REVIEW_DEFAULTS)) {
    return reviewOptions;
  }
  const defaults = hasSession
    ? { preApply: true, postApply: false, strictness: "balanced", blockOn: ["syntax", "guardrails", "vibe"] }
    : { preApply: true, postApply: false, strictness: "permissive", blockOn: ["syntax"] };
  const hasBlockOn = Array.isArray(reviewOptions?.blockOn);
  return {
    ...defaults,
    ...reviewOptions,
    blockOn: hasBlockOn ? reviewOptions.blockOn : defaults.blockOn
  };
};

export const resolveStylePack = (input: any, artifactManager?: FlowArtifactManager): StylePack | undefined => {
  if (!input) return undefined;
  if (typeof input === "string") {
    const artifact = artifactManager?.get(input);
    if (artifact?.type === "style" && "pack" in artifact) {
      return artifact.pack as StylePack;
    }
    return undefined;
  }
  if (input && typeof input === "object") {
    if ("profile" in input && "createdAt" in input) {
      return input as StylePack;
    }
    if (input?.type === "style" && input?.pack) {
      return input.pack as StylePack;
    }
  }
  return undefined;
};
