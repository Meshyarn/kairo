export type CompatFinding = {
  severity: "info" | "warning" | "critical";
  code:
    | "SCHEMA_ALIAS_USED"
    | "UNKNOWN_FIELDS_IGNORED"
    | "COERCION_APPLIED"
    | "DEPRECATED_FIELD_USED"
    | "SCHEMA_VERSION_MISMATCH";
  message: string;
  details?: any;
};
