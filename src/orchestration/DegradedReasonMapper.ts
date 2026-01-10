import type { DegradedReason, DegradedReasonType } from "../types/tool-responses.js";

const DEFAULT_CONTRACT_ACTION = "Run manage doctor --scope=contracts";
const DEFAULT_LANGUAGE_ACTION = "Run manage doctor --scope=languages";

const CONTRACT_REASON_MAP: Record<string, { type: DegradedReasonType; message: string; action?: string }> = {
  contract_manifest_missing: {
    type: "cross_lang_contract_missing",
    message: "Contract manifest is missing.",
    action: DEFAULT_CONTRACT_ACTION
  },
  contract_manifest_invalid: {
    type: "cross_lang_contract_invalid",
    message: "Contract manifest schema is invalid.",
    action: DEFAULT_CONTRACT_ACTION
  },
  contract_manifest_stale: {
    type: "cross_lang_contract_stale",
    message: "Contract manifest is stale.",
    action: DEFAULT_CONTRACT_ACTION
  },
  contract_adapter_missing: {
    type: "cross_lang_contract_missing",
    message: "Contract adapter is missing for this boundary.",
    action: DEFAULT_CONTRACT_ACTION
  },
  contract_non_breaking_change: {
    type: "cross_lang_contract_degraded",
    message: "Contract surface changed (non-breaking).",
    action: DEFAULT_CONTRACT_ACTION
  },
  cross_lang_contract_degraded: {
    type: "cross_lang_contract_degraded",
    message: "Cross-language impact used fallback linking; results may be incomplete.",
    action: DEFAULT_CONTRACT_ACTION
  }
};

const PARITY_REASON_MAP: Record<string, { type: DegradedReasonType; message: string; action?: string }> = {
  budget_exceeded: {
    type: "budget_exceeded",
    message: "Token or time budget exceeded; results may be partial."
  },
  doc_search_skipped: {
    type: "doc_search_skipped",
    message: "Documentation search was skipped; results may be incomplete."
  },
  unsupported_language: {
    type: "unsupported_language",
    message: "Language is not supported by the current runtime.",
    action: DEFAULT_LANGUAGE_ACTION
  },
  missing_query_pack: {
    type: "missing_query_pack",
    message: "Query pack is missing for this language.",
    action: DEFAULT_LANGUAGE_ACTION
  },
  missing_wasm_grammar: {
    type: "missing_wasm_grammar",
    message: "WASM grammar is missing for this language.",
    action: DEFAULT_LANGUAGE_ACTION
  },
  syntax_validation_failed: {
    type: "syntax_validation_failed",
    message: "Syntax validation failed for the target content."
  },
  skeleton_extraction_failed: {
    type: "skeleton_extraction_failed",
    message: "Skeleton extraction failed for the target content."
  },
  symbol_index_unavailable: {
    type: "symbol_index_unavailable",
    message: "Symbol index is unavailable; symbol-based analysis is degraded."
  },
  language_parser_unavailable: {
    type: "missing_wasm_grammar",
    message: "Language parser is unavailable.",
    action: DEFAULT_LANGUAGE_ACTION
  },
  language_query_missing: {
    type: "missing_query_pack",
    message: "Language query pack is missing.",
    action: DEFAULT_LANGUAGE_ACTION
  }
};

export function buildDegradedReasons(
  reasons: string[] | undefined,
  options?: { packageName?: string; languageId?: string; filePath?: string }
): DegradedReason[] | undefined {
  if (!Array.isArray(reasons) || reasons.length === 0) {
    return undefined;
  }

  const combinedMap = { ...CONTRACT_REASON_MAP, ...PARITY_REASON_MAP };
  const results: DegradedReason[] = [];
  for (const reason of reasons) {
    if (typeof reason !== "string" || reason.length === 0) continue;
    const mapped = combinedMap[reason];
    if (mapped) {
      results.push({
        type: mapped.type,
        packageName: options?.packageName,
        languageId: options?.languageId,
        filePath: options?.filePath,
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
