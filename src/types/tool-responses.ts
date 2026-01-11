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
  | "syntax_validation_failed"
  | "skeleton_extraction_failed"
  | "symbol_index_unavailable"
  | "degraded";

export type DegradedReason = {
  type: DegradedReasonType;
  languageId?: string;
  packageName?: string;
  filePath?: string;
  message: string;
  action?: string;
};
