import { FeatureFlags } from "../../../config/FeatureFlags.js";
import type { StylePack } from "../../../types/flow-artifacts.js";
import type { FlowArtifactManager } from "../../flow-artifact-manager.js";
import type { FileVersionManager } from "../../../engine/FileVersionManager.js";
import type { PathNormalizer } from "../../../utils/PathNormalizer.js";

export const resolveReviewOptions = (raw: any, hasSession: boolean): any => {
  const reviewOptions = raw ?? {};
  if (!FeatureFlags.isEnabled(FeatureFlags.WRITERS_FLOW_REVIEW_DEFAULTS)) {
    return reviewOptions;
  }
  const defaults = hasSession
    ? { preApply: true, postApply: false, strictness: "balanced", blockOn: ["syntax", "guardrails"] }
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

export const buildFileVersionsSnapshot = async (
  filePaths: string[],
  fileVersionManager?: FileVersionManager,
  pathNormalizer?: PathNormalizer
): Promise<Record<string, { expectedVersion?: number; expectedHash?: string }> | undefined> => {
  if (!fileVersionManager || !pathNormalizer) return undefined;
  const snapshot: Record<string, { expectedVersion?: number; expectedHash?: string }> = {};
  const uniquePaths = Array.from(new Set(filePaths.filter(Boolean)));
  for (const filePath of uniquePaths) {
    const relPath = pathNormalizer.normalize(filePath);
    try {
      const absPath = pathNormalizer.toAbsolute(relPath);
      const versionInfo = await fileVersionManager.getVersion(absPath);
      snapshot[relPath] = {
        expectedVersion: versionInfo.version,
        expectedHash: versionInfo.contentHash
      };
    } catch {
      // skip missing files
    }
  }
  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
};

export const detectFileVersionMismatch = async (
  fileVersions: Record<string, { expectedVersion?: number; expectedHash?: string }>,
  fileVersionManager: FileVersionManager,
  pathNormalizer: PathNormalizer
): Promise<{ filePath: string } | null> => {
  for (const [relPath, expected] of Object.entries(fileVersions)) {
    if (!expected) continue;
    try {
      const absPath = pathNormalizer.toAbsolute(pathNormalizer.normalize(relPath));
      const current = await fileVersionManager.getVersion(absPath);
      if (typeof expected.expectedHash === "string" && expected.expectedHash.length > 0 && expected.expectedHash !== current.contentHash) {
        return { filePath: relPath };
      }
      if (typeof expected.expectedVersion === "number" && expected.expectedVersion !== current.version) {
        return { filePath: relPath };
      }
    } catch {
      return { filePath: relPath };
    }
  }
  return null;
};

export const buildFailureGuidance = (args: any) => ({
  message: args.failureMessage || "Change failed.",
  suggestedActions: [
    {
      id: "read.view_fragment",
      priority: 1,
      description: "View the exact target fragment.",
      rationale: "Confirm the current content before retrying.",
      toolCall: { tool: "read", args: { action: "view_fragment", target: args.targetPath } }
    },
    {
      id: "change.retry",
      priority: 2,
      description: "Retry change with updated target text.",
      rationale: "Retry after verifying the current content.",
      toolCall: { tool: "change", args: { action: "retry", intent: args.intent, target: args.targetPath } }
    }
  ]
});

export const buildDraftApplyEdits = (args: {
  filePath: string;
  originalContent: string;
  draftContent: string;
}): any[] => {
  if (args.originalContent.length === 0) {
    return [{
      filePath: args.filePath,
      targetString: "",
      replacementString: args.draftContent,
      insertMode: "at",
      insertLineRange: { start: 1 }
    }];
  }
  return [{
    filePath: args.filePath,
    targetString: args.originalContent,
    replacementString: args.draftContent,
    indexRange: { start: 0, end: args.originalContent.length }
  }];
};
