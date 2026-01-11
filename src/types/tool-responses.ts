export type DegradedReasonType =
  | "cross_lang_contract_missing"
  | "cross_lang_contract_stale"
  | "cross_lang_contract_invalid"
  | "cross_lang_contract_degraded"
  | "degraded";

export type DegradedReason = {
  type: DegradedReasonType;
  packageName?: string;
  message: string;
  action?: string;
};
