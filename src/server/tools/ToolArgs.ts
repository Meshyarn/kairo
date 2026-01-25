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

  if (mode === "compat") {
    applyCanonicalizationV2(toolSpec, args, findings);
  }

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

  const valueAliases = toolSpec.compat?.valueAliases ?? [];
  for (const alias of valueAliases) {
    const value = getPathValue(args, alias.path);
    if (value === undefined) continue;
    if (value !== alias.from) continue;
    setPathValue(args, alias.path, alias.to);
    findings.push({
      severity: alias.policy === "error" ? "critical" : "warning",
      code: alias.policy === "deprecate" ? "DEPRECATED_FIELD_USED" : "SCHEMA_ALIAS_USED",
      message: alias.message,
      details: { path: alias.path, from: alias.from, to: alias.to }
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

  if (mode === "compat") {
    applySchemaCoercions(toolSpec.inputSchema, args, findings);
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

function applyCanonicalizationV2(
  toolSpec: ToolSpec,
  args: Record<string, any>,
  findings: CompatFinding[]
): void {
  const schema = toolSpec.inputSchema;
  const hasLimitsMaxTokens = schemaHasPath(schema, "limits.maxTokens");
  const hasOutputMaxTokens = schemaHasPath(schema, "output.maxTokens");
  const hasLimitsMaxResults = schemaHasPath(schema, "limits.maxResults");
  const hasTopLevelLimit = schemaHasTopLevelProperty(schema, "limit");
  const hasTopLevelMaxResults = schemaHasTopLevelProperty(schema, "maxResults");
  const hasTopLevelTopK = schemaHasTopLevelProperty(schema, "topK");

  if (hasLimitsMaxTokens) {
    applyAliasPath(args, "limits.max_tokens", "limits.maxTokens", findings, "Use limits.maxTokens instead of limits.max_tokens.");
    applyAliasPath(args, "limits.max_token", "limits.maxTokens", findings, "Use limits.maxTokens instead of limits.max_token.");
  }
  if (hasOutputMaxTokens) {
    applyAliasPath(args, "output.max_tokens", "output.maxTokens", findings, "Use output.maxTokens instead of output.max_tokens.");
    applyAliasPath(args, "output.max_token", "output.maxTokens", findings, "Use output.maxTokens instead of output.max_token.");
  }

  const maxTokenTarget = hasOutputMaxTokens ? "output.maxTokens" : (hasLimitsMaxTokens ? "limits.maxTokens" : undefined);
  if (maxTokenTarget) {
    applyAliasKeys(
      args,
      ["maxTokens", "max_tokens", "max_token"],
      maxTokenTarget,
      findings,
      `Mapped max token field to ${maxTokenTarget}.`
    );
  }

  if (hasLimitsMaxResults && !hasTopLevelLimit && !hasTopLevelMaxResults && !hasTopLevelTopK) {
    applyAliasKeys(
      args,
      ["maxResults", "max_results", "topK", "top_k", "limit"],
      "limits.maxResults",
      findings,
      "Mapped result limit field to limits.maxResults."
    );
  }

  applyFileAliasMapping(toolSpec, args, findings);
  applyDryRunAlias(toolSpec, args, findings);
}

function applyFileAliasMapping(
  toolSpec: ToolSpec,
  args: Record<string, any>,
  findings: CompatFinding[]
): void {
  const schema = toolSpec.inputSchema;
  const hasPaths = schemaHasTopLevelProperty(schema, "paths");
  const hasTargetFiles = schemaHasTopLevelProperty(schema, "targetFiles");
  if (!hasPaths && !hasTargetFiles) {
    return;
  }

  const aliasKeys = ["files", "file", "paths"];
  for (const key of aliasKeys) {
    const value = args[key];
    if (value === undefined || value === null) continue;

    let targetPath: string | undefined;
    if (toolSpec.name === "task") {
      if (key === "paths") {
        targetPath = hasPaths ? "paths" : undefined;
      } else {
        const mode = typeof args.mode === "string" ? args.mode : undefined;
        if (mode === "plan_change" || mode === "apply_change" || mode === "write") {
          targetPath = hasTargetFiles ? "targetFiles" : (hasPaths ? "paths" : undefined);
        } else {
          targetPath = hasPaths ? "paths" : (hasTargetFiles ? "targetFiles" : undefined);
        }
      }
    } else if (hasTargetFiles && hasPaths) {
      targetPath = key === "paths" ? "paths" : "targetFiles";
    } else if (hasTargetFiles) {
      targetPath = "targetFiles";
    } else if (hasPaths) {
      targetPath = "paths";
    }

    if (!targetPath) continue;
    applyAliasPath(args, key, targetPath, findings, `Mapped ${key} to ${targetPath}.`);
  }
}

function applyDryRunAlias(
  toolSpec: ToolSpec,
  args: Record<string, any>,
  findings: CompatFinding[]
): void {
  if (!schemaHasTopLevelProperty(toolSpec.inputSchema, "safety")) return;
  const hasDryRun = schemaHasTopLevelProperty(toolSpec.inputSchema, "dryRun");
  if (hasDryRun) return;
  const raw = args.dryRun;
  const coerced = coerceBoolean(raw);
  if (coerced !== true) return;

  let changed = false;
  if (schemaHasPath(toolSpec.inputSchema, "options.dryRun")) {
    if (getPathValue(args, "options.dryRun") === undefined) {
      setPathValue(args, "options.dryRun", true);
      changed = true;
    }
  }
  if (getPathValue(args, "safety") === undefined) {
    setPathValue(args, "safety", "plan");
    changed = true;
  }
  delete args.dryRun;
  changed = true;
  if (changed) {
    findings.push({
      severity: "warning",
      code: "SCHEMA_ALIAS_USED",
      message: "Mapped dryRun=true to safety=plan.",
      details: { from: "dryRun", to: "safety" }
    });
  }
}

function applySchemaCoercions(
  schema: ToolSpec["inputSchema"],
  args: Record<string, any>,
  findings: CompatFinding[],
  prefix: string = ""
): void {
  const properties = schema?.properties ?? {};
  for (const [key, spec] of Object.entries(properties)) {
    if (!Object.prototype.hasOwnProperty.call(args, key)) continue;
    const value = args[key];
    if (value === undefined || value === null) continue;
    const path = prefix ? `${prefix}.${key}` : key;

    if (spec?.type === "array" && !Array.isArray(value)) {
      args[key] = [value];
      findings.push({
        severity: "warning",
        code: "COERCION_APPLIED",
        message: `Coerced ${path} to array.`,
        details: { from: value, to: args[key] }
      });
      continue;
    }

    if (spec?.type === "number" && typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        args[key] = parsed;
        findings.push({
          severity: "warning",
          code: "COERCION_APPLIED",
          message: `Coerced ${path} from string to number.`,
          details: { from: value, to: parsed }
        });
      }
      continue;
    }

    if (spec?.type === "boolean" && typeof value === "string") {
      const coerced = coerceBoolean(value);
      if (typeof coerced === "boolean") {
        args[key] = coerced;
        findings.push({
          severity: "warning",
          code: "COERCION_APPLIED",
          message: `Coerced ${path} from string to boolean.`,
          details: { from: value, to: coerced }
        });
      }
      continue;
    }

    if (spec?.type === "object" && isPlainObject(value)) {
      applySchemaCoercions(spec, value, findings, path);
    }
  }
}

function applyAliasKeys(
  args: Record<string, any>,
  keys: string[],
  targetPath: string,
  findings: CompatFinding[],
  message: string
): void {
  for (const key of keys) {
    const value = getPathValue(args, key);
    if (value === undefined) continue;
    applyAliasPath(args, key, targetPath, findings, message);
  }
}

function applyAliasPath(
  args: Record<string, any>,
  fromPath: string,
  toPath: string,
  findings: CompatFinding[],
  message: string
): void {
  if (fromPath === toPath) return;
  const value = getPathValue(args, fromPath);
  if (value === undefined) return;
  const targetValue = getPathValue(args, toPath);
  if (targetValue === undefined) {
    setPathValue(args, toPath, value);
  }
  deletePathValue(args, fromPath);
  findings.push({
    severity: "warning",
    code: "SCHEMA_ALIAS_USED",
    message,
    details: { from: fromPath, to: toPath }
  });
}

function schemaHasTopLevelProperty(schema: ToolSpec["inputSchema"], key: string): boolean {
  return Boolean(schema?.properties && Object.prototype.hasOwnProperty.call(schema.properties, key));
}

function schemaHasPath(schema: ToolSpec["inputSchema"], path: string): boolean {
  const parts = path.split(".");
  let current: any = schema;
  for (const part of parts) {
    if (!current?.properties) return false;
    const next = current.properties[part];
    if (!next) return false;
    current = next;
  }
  return true;
}

function coerceBoolean(value: any): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}
