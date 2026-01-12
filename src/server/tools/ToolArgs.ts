import type { ToolSchemaMode, ToolSpec } from "./ToolSpecRegistry.js";

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

export type ToolContractMeta = {
  tool: string;
  schemaVersion: string;
  mode: ToolSchemaMode;
  findings?: CompatFinding[];
  effectiveArgs?: any;
};

export type NormalizedArgsResult = {
  args: Record<string, any>;
  findings: CompatFinding[];
  droppedFields: string[];
};

type ValidationResult = {
  missing: string[];
  invalid: Array<{ path: string; expected: string; actual: string }>;
  unknown: string[];
};

export function getToolSchemaMode(): ToolSchemaMode {
  return process.env.KAIRO_TOOL_SCHEMA_MODE === "strict" ? "strict" : "compat";
}

export function normalizeArgs(toolSpec: ToolSpec, rawArgs: any, mode: ToolSchemaMode): NormalizedArgsResult {
  const args = isPlainObject(rawArgs) ? { ...rawArgs } : {};
  const findings: CompatFinding[] = [];
  const droppedFields: string[] = [];

  const aliases = toolSpec.compat?.aliases ?? [];
  for (const alias of aliases) {
    const value = getPathValue(args, alias.from);
    if (value === undefined) continue;
    const targetValue = getPathValue(args, alias.to);
    if (targetValue === undefined) {
      setPathValue(args, alias.to, value);
    }
    deletePathValue(args, alias.from);
    findings.push({
      severity: alias.policy === "error" ? "critical" : "warning",
      code: alias.policy === "deprecate" ? "DEPRECATED_FIELD_USED" : "SCHEMA_ALIAS_USED",
      message: alias.message,
      details: { from: alias.from, to: alias.to }
    });
  }

  const coercions = toolSpec.compat?.coercions ?? [];
  for (const coercion of coercions) {
    const value = getPathValue(args, coercion.path);
    if (value === undefined) continue;
    if (coercion.from === "string" && coercion.to === "number" && typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        setPathValue(args, coercion.path, parsed);
        findings.push({
          severity: coercion.policy === "error" ? "critical" : "warning",
          code: "COERCION_APPLIED",
          message: `Coerced ${coercion.path} from string to number.`,
          details: { from: value, to: parsed }
        });
      }
    }
  }

  const defaults = toolSpec.compat?.defaults ?? [];
  for (const entry of defaults) {
    const current = getPathValue(args, entry.path);
    if (current === undefined) {
      setPathValue(args, entry.path, entry.value);
    }
  }

  if (mode === "compat" && toolSpec.inputSchema?.additionalProperties === false) {
    const allowed = new Set(Object.keys(toolSpec.inputSchema.properties ?? {}));
    for (const key of Object.keys(args)) {
      if (!allowed.has(key)) {
        droppedFields.push(key);
        delete args[key];
      }
    }
    if (droppedFields.length > 0) {
      findings.push({
        severity: "warning",
        code: "UNKNOWN_FIELDS_IGNORED",
        message: `Unknown fields were ignored: ${droppedFields.join(", ")}`,
        details: { fields: droppedFields }
      });
    }
  }

  return { args, findings, droppedFields };
}

export function validateArgs(toolSpec: ToolSpec, args: Record<string, any>, mode: ToolSchemaMode): ValidationResult {
  const missing: string[] = [];
  const invalid: Array<{ path: string; expected: string; actual: string }> = [];
  const unknown: string[] = [];

  const schema = toolSpec.inputSchema;
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (args[key] === undefined || args[key] === null) {
      missing.push(key);
    }
  }

  const properties = schema.properties ?? {};
  for (const [key, value] of Object.entries(args)) {
    const spec = properties[key];
    if (!spec) {
      unknown.push(key);
      continue;
    }
    if (spec.type === "string" && typeof value !== "string") {
      invalid.push({ path: key, expected: "string", actual: typeof value });
    }
    if (spec.type === "number" && typeof value !== "number") {
      invalid.push({ path: key, expected: "number", actual: typeof value });
    }
    if (spec.type === "boolean" && typeof value !== "boolean") {
      invalid.push({ path: key, expected: "boolean", actual: typeof value });
    }
    if (spec.type === "array" && !Array.isArray(value)) {
      invalid.push({ path: key, expected: "array", actual: typeof value });
    }
    if (spec.type === "object" && !isPlainObject(value)) {
      invalid.push({ path: key, expected: "object", actual: typeof value });
    }
  }

  if (mode === "strict" && schema.additionalProperties === false && unknown.length > 0) {
    invalid.push({ path: "(unknown)", expected: "no extra fields", actual: unknown.join(", ") });
  }

  return { missing, invalid, unknown };
}

export function buildContractMeta(toolSpec: ToolSpec, mode: ToolSchemaMode, findings: CompatFinding[], args?: any): ToolContractMeta {
  return {
    tool: toolSpec.name,
    schemaVersion: toolSpec.schemaVersion,
    mode,
    findings: findings.length > 0 ? findings : undefined,
    effectiveArgs: args
  };
}

function getPathValue(obj: Record<string, any>, path: string): any {
  const parts = path.split(".");
  let current: any = obj;
  for (const part of parts) {
    if (!isPlainObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

function setPathValue(obj: Record<string, any>, path: string, value: any): void {
  const parts = path.split(".");
  let current: any = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!isPlainObject(current[key])) {
      current[key] = {};
    }
    current = current[key];
  }
  current[parts[parts.length - 1]] = value;
}

function deletePathValue(obj: Record<string, any>, path: string): void {
  const parts = path.split(".");
  let current: any = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!isPlainObject(current)) return;
    current = current[parts[i]];
  }
  if (isPlainObject(current)) {
    delete current[parts[parts.length - 1]];
  }
}

function isPlainObject(value: any): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
