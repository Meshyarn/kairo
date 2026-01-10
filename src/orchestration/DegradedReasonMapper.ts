import type { DegradedReason, DegradedReasonType } from "../types/tool-responses.js";

const DEFAULT_ACTION = "Run manage doctor --scope=contracts";

const CONTRACT_REASON_MAP: Record<string, { type: DegradedReasonType; message: string; action?: string }> = {
  contract_manifest_missing: {
    type: "cross_lang_contract_missing",
    message: "Contract manifest is missing.",
    action: DEFAULT_ACTION
  },
  contract_manifest_invalid: {
    type: "cross_lang_contract_invalid",
    message: "Contract manifest schema is invalid.",
    action: DEFAULT_ACTION
  },
  contract_manifest_stale: {
    type: "cross_lang_contract_stale",
    message: "Contract manifest is stale.",
    action: DEFAULT_ACTION
  },
  contract_adapter_missing: {
    type: "cross_lang_contract_missing",
    message: "Contract adapter is missing for this boundary.",
    action: DEFAULT_ACTION
  },
  contract_non_breaking_change: {
    type: "cross_lang_contract_degraded",
    message: "Contract surface changed (non-breaking).",
    action: DEFAULT_ACTION
  }
};

export function buildDegradedReasons(
  reasons: string[] | undefined,
  options?: { packageName?: string }
): DegradedReason[] | undefined {
  if (!Array.isArray(reasons) || reasons.length === 0) {
    return undefined;
  }

  const results: DegradedReason[] = [];
  for (const reason of reasons) {
    if (typeof reason !== "string" || reason.length === 0) continue;
    const mapped = CONTRACT_REASON_MAP[reason];
    if (mapped) {
      results.push({
        type: mapped.type,
        packageName: options?.packageName,
        message: mapped.message,
        action: mapped.action
      });
      continue;
    }
    results.push({
      type: "degraded",
      message: reason
    });
  }

  return results.length > 0 ? results : undefined;
}
