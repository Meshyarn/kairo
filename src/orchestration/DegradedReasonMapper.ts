import type { DegradedReason, DegradedReasonType } from "../types/tool-responses.js";

const CONTRACT_ACTION_TOOLCALL = { tool: "manage", args: { command: "doctor", scope: "contracts" } };
const LANGUAGE_ACTION_TOOLCALL = { tool: "manage", args: { command: "doctor", scope: "languages" } };
const PARITY_ACTION_TOOLCALL = { tool: "manage", args: { command: "doctor", scope: "parity" } };

const CONTRACT_ACTION_ID = "manage.doctor.contracts";
const LANGUAGE_ACTION_ID = "manage.doctor.languages";
const PARITY_ACTION_ID = "manage.doctor.parity";

const CONTRACT_REASON_MAP: Record<string, {
  type: DegradedReasonType;
  message: string;
  actionToolCall?: { tool: string; args: Record<string, unknown> };
  actionId?: string;
}> = {
  contract_manifest_missing: {
    type: "cross_lang_contract_missing",
    message: "Contract manifest is missing.",
    actionToolCall: CONTRACT_ACTION_TOOLCALL,
    actionId: CONTRACT_ACTION_ID
  },
  contract_manifest_invalid: {
    type: "cross_lang_contract_invalid",
    message: "Contract manifest schema is invalid.",
    actionToolCall: CONTRACT_ACTION_TOOLCALL,
    actionId: CONTRACT_ACTION_ID
  },
  contract_manifest_stale: {
    type: "cross_lang_contract_stale",
    message: "Contract manifest is stale.",
    actionToolCall: CONTRACT_ACTION_TOOLCALL,
    actionId: CONTRACT_ACTION_ID
  },
  contract_adapter_missing: {
    type: "cross_lang_contract_missing",
    message: "Contract adapter is missing for this boundary.",
    actionToolCall: CONTRACT_ACTION_TOOLCALL,
    actionId: CONTRACT_ACTION_ID
  },
  contract_non_breaking_change: {
    type: "cross_lang_contract_degraded",
    message: "Contract surface changed (non-breaking).",
    actionToolCall: CONTRACT_ACTION_TOOLCALL,
    actionId: CONTRACT_ACTION_ID
  },
  cross_lang_contract_degraded: {
    type: "cross_lang_contract_degraded",
    message: "Cross-language impact used fallback linking; results may be incomplete.",
    actionToolCall: CONTRACT_ACTION_TOOLCALL,
    actionId: CONTRACT_ACTION_ID
  }
};

const PARITY_REASON_MAP: Record<string, {
  type: DegradedReasonType;
  message: string;
  actionToolCall?: { tool: string; args: Record<string, unknown> };
  actionId?: string;
}> = {
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
    actionToolCall: LANGUAGE_ACTION_TOOLCALL,
    actionId: LANGUAGE_ACTION_ID
  },
  missing_query_pack: {
    type: "missing_query_pack",
    message: "Query pack is missing for this language.",
    actionToolCall: PARITY_ACTION_TOOLCALL,
    actionId: PARITY_ACTION_ID
  },
  missing_wasm_grammar: {
    type: "missing_wasm_grammar",
    message: "WASM grammar is missing for this language.",
    actionToolCall: PARITY_ACTION_TOOLCALL,
    actionId: PARITY_ACTION_ID
  },
  missing_syntax_validator: {
    type: "missing_syntax_validator",
    message: "Syntax validator is missing for this language.",
    actionToolCall: PARITY_ACTION_TOOLCALL,
    actionId: PARITY_ACTION_ID
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
  cross_repo_scope_mismatch: {
    type: "cross_repo_scope_mismatch",
    message: "Requested repo scope does not include matching files."
  },
  cross_repo_edit_blocked: {
    type: "cross_repo_edit_blocked",
    message: "Cross-repo edits are blocked by policy."
  },
  language_parser_unavailable: {
    type: "missing_wasm_grammar",
    message: "Language parser is unavailable.",
    actionToolCall: PARITY_ACTION_TOOLCALL,
    actionId: PARITY_ACTION_ID
  },
  language_query_missing: {
    type: "missing_query_pack",
    message: "Language query pack is missing.",
    actionToolCall: PARITY_ACTION_TOOLCALL,
    actionId: PARITY_ACTION_ID
  },
  document_sampled: {
    type: "degraded",
    message: "Document content was sampled; results may be partial.",
    actionToolCall: PARITY_ACTION_TOOLCALL,
    actionId: PARITY_ACTION_ID
  },
  document_extract_failed: {
    type: "degraded",
    message: "Document extraction failed.",
    actionToolCall: PARITY_ACTION_TOOLCALL,
    actionId: PARITY_ACTION_ID
  },
  document_parser_missing: {
    type: "degraded",
    message: "Document parser is missing or unavailable.",
    actionToolCall: PARITY_ACTION_TOOLCALL,
    actionId: PARITY_ACTION_ID
  },
  document_needs_ocr: {
    type: "degraded",
    message: "Document appears to require OCR for reliable text extraction.",
    actionToolCall: PARITY_ACTION_TOOLCALL,
    actionId: PARITY_ACTION_ID
  },
  document_cap_applied: {
    type: "degraded",
    message: "Document extraction hit a configured cap.",
    actionToolCall: PARITY_ACTION_TOOLCALL,
    actionId: PARITY_ACTION_ID
  },
  document_low_quality: {
    type: "degraded",
    message: "Document extraction quality is low; results may be incomplete.",
    actionToolCall: PARITY_ACTION_TOOLCALL,
    actionId: PARITY_ACTION_ID
  },
  file_version_mismatch: {
    type: "degraded",
    message: "File version mismatch detected; re-read the file before retrying."
  },
  symbol_semantic_search_disabled: {
    type: "degraded",
    message: "Symbol semantic search is disabled."
  },
  symbol_embeddings_not_built: {
    type: "degraded",
    message: "Symbol embeddings are not built; run a build to enable semantic symbol search.",
    actionToolCall: { tool: "project_manage", args: { command: "symbol_index_build" } },
    actionId: "project_manage.symbol_index_build"
  },
  embedding_provider_disabled: {
    type: "degraded",
    message: "Embedding provider is disabled or hash-only; semantic symbol search is unavailable."
  },
  vector_index_disabled: {
    type: "degraded",
    message: "Vector index is disabled; semantic symbol search is unavailable."
  },
  vector_index_unavailable: {
    type: "degraded",
    message: "Vector index is unavailable; rebuild the vector index."
  },
  symbol_search_fallback_name: {
    type: "degraded",
    message: "Semantic symbol search returned no results; fell back to name search."
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
        actionToolCall: mapped.actionToolCall,
        actionId: mapped.actionId
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
