import type { IndexStateManager } from "../../../indexing/IndexStateManager.js";

export const escapeRegExp = (value: string): string => (
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
);

export const editsLookLikePublicApiChange = (edits: any[]): boolean => {
  const signals = /\b(export|public|pub|interface|type|class|struct|enum|fn|def)\b/;
  for (const edit of edits ?? []) {
    const target = typeof edit?.targetString === "string" ? edit.targetString : "";
    const replacement = typeof edit?.replacementString === "string" ? edit.replacementString : "";
    if (signals.test(target) || signals.test(replacement)) {
      return true;
    }
  }
  return false;
};

export const shouldSuggestImpact = (targetPath: string, guardrailResult: any, edits: any[]): boolean => {
  const publicSurface = guardrailResult?.architecturalRisk?.publicSurface;
  if (publicSurface?.hasChanges) return true;
  if (/index\.d\.ts$/i.test(targetPath)) return true;
  if (/package\.json$/i.test(targetPath)) return true;
  if (editsLookLikePublicApiChange(edits)) return true;
  return false;
};

export const checkStaleGuard = async (args: {
  indexStateManager?: IndexStateManager;
  dryRun: boolean;
  bypass: boolean;
  workflowWarnings: string[];
}): Promise<{ blocked: boolean; message: string; snapshot?: any }> => {
  if (args.dryRun || !args.indexStateManager) {
    return { blocked: false, message: "" };
  }
  const snapshot = await args.indexStateManager.getSnapshot();
  if (snapshot.staleRisk !== "high") {
    return { blocked: false, message: "", snapshot };
  }
  if (args.bypass) {
    args.workflowWarnings.push("Override bypassed stale index guard.");
    return { blocked: false, message: "", snapshot };
  }
  return {
    blocked: true,
    message: "Index staleness is high; reindex before apply.",
    snapshot
  };
};
