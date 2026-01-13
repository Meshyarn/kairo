export type DegradedReasonType =
  | "cross_lang_contract_missing"
  | "cross_lang_contract_stale"
  | "cross_lang_contract_invalid"
  | "cross_lang_contract_degraded"
  | "budget_exceeded"
  | "doc_search_skipped"
  | "unsupported_language"
  | "missing_query_pack"
  | "missing_wasm_grammar"
  | "missing_syntax_validator"
  | "syntax_validation_failed"
  | "skeleton_extraction_failed"
  | "symbol_index_unavailable"
  | "cross_repo_scope_mismatch"
  | "cross_repo_edit_blocked"
  | "degraded";

export type DegradedReason = {
  type: DegradedReasonType;
  languageId?: string;
  packageName?: string;
  filePath?: string;
  message: string;
  actionToolCall?: { tool: string; args: Record<string, unknown> };
  actionId?: string;
};
