import type { ToolSpec } from "./ToolSpecRegistry.js";
import type { CompatFinding } from "./ToolArgsTypes.js";

export const getPathValue = (obj: Record<string, any>, path: string): any => {
  const parts = path.split(".");
  let current: any = obj;
  for (const part of parts) {
    if (!isPlainObject(current)) return undefined;
    current = current[part];
  }
  return current;
};

export const setPathValue = (obj: Record<string, any>, path: string, value: any): void => {
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
};

export const deletePathValue = (obj: Record<string, any>, path: string): void => {
  const parts = path.split(".");
  let current: any = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!isPlainObject(current)) return;
    current = current[parts[i]];
  }
  if (isPlainObject(current)) {
    delete current[parts[parts.length - 1]];
  }
};

export const isPlainObject = (value: any): value is Record<string, any> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

export const applyCanonicalizationV2 = (
  toolSpec: ToolSpec,
  args: Record<string, any>,
  findings: CompatFinding[]
): void => {
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
  applyContentSourceAliasMapping(toolSpec, args, findings);
};

export const applySchemaCoercions = (
  schema: ToolSpec["inputSchema"],
  args: Record<string, any>,
  findings: CompatFinding[],
  prefix: string = ""
): void => {
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
};

const applyFileAliasMapping = (
  toolSpec: ToolSpec,
  args: Record<string, any>,
  findings: CompatFinding[]
): void => {
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
};

const applyDryRunAlias = (
  toolSpec: ToolSpec,
  args: Record<string, any>,
  findings: CompatFinding[]
): void => {
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
};

const applyContentSourceAliasMapping = (
  toolSpec: ToolSpec,
  args: Record<string, any>,
  findings: CompatFinding[]
): void => {
  if (toolSpec.name === "write") {
    const contentBase64 = typeof args.contentBase64 === "string" ? args.contentBase64 : undefined;
    const contentB64 = typeof args.contentB64 === "string" ? args.contentB64 : undefined;
    const hasContentBase64 = typeof contentBase64 === "string" && contentBase64.length > 0;
    const hasContentB64 = typeof contentB64 === "string" && contentB64.length > 0;
    const chosenBase64 = hasContentBase64 ? contentBase64 : (hasContentB64 ? contentB64 : undefined);

    if ((hasContentBase64 || hasContentB64) && args.contentSource === undefined && chosenBase64) {
      args.contentSource = { kind: "base64", base64: chosenBase64, charset: "utf8" };
    }

    if (hasContentBase64) {
      findings.push({
        severity: "warning",
        code: "DEPRECATED_FIELD_USED",
        message: "contentBase64 is deprecated. Use contentSource with kind=base64 instead.",
        details: { from: "contentBase64", to: "contentSource", kind: "base64" }
      });
      delete args.contentBase64;
    }
    if (hasContentB64) {
      findings.push({
        severity: "warning",
        code: "DEPRECATED_FIELD_USED",
        message: "contentB64 is deprecated. Use contentSource with kind=base64 instead.",
        details: { from: "contentB64", to: "contentSource", kind: "base64" }
      });
      delete args.contentB64;
    }
    return;
  }

  if (toolSpec.name !== "change") return;
  if (!Array.isArray(args.edits)) return;

  args.edits = args.edits.map((edit: any, index: number) => {
    if (!isPlainObject(edit)) return edit;
    const next = { ...edit };
    const targetStringBase64 = typeof next.targetStringBase64 === "string" ? next.targetStringBase64 : undefined;
    const targetBase64 = typeof next.targetBase64 === "string" ? next.targetBase64 : undefined;
    const replacementStringBase64 = typeof next.replacementStringBase64 === "string" ? next.replacementStringBase64 : undefined;
    const replacementBase64 = typeof next.replacementBase64 === "string" ? next.replacementBase64 : undefined;

    const hasTargetStringBase64 = typeof targetStringBase64 === "string" && targetStringBase64.length > 0;
    const hasTargetBase64 = typeof targetBase64 === "string" && targetBase64.length > 0;
    const hasReplacementStringBase64 = typeof replacementStringBase64 === "string" && replacementStringBase64.length > 0;
    const hasReplacementBase64 = typeof replacementBase64 === "string" && replacementBase64.length > 0;

    const targetBase64Value = hasTargetStringBase64 ? targetStringBase64 : (hasTargetBase64 ? targetBase64 : undefined);
    const replacementBase64Value = hasReplacementStringBase64
      ? replacementStringBase64
      : (hasReplacementBase64 ? replacementBase64 : undefined);

    if ((hasTargetStringBase64 || hasTargetBase64) && next.targetSource === undefined && targetBase64Value) {
      next.targetSource = { kind: "base64", base64: targetBase64Value, charset: "utf8" };
    }
    if ((hasReplacementStringBase64 || hasReplacementBase64) && next.replacementSource === undefined && replacementBase64Value) {
      next.replacementSource = { kind: "base64", base64: replacementBase64Value, charset: "utf8" };
    }

    if (hasTargetStringBase64) {
      findings.push({
        severity: "warning",
        code: "DEPRECATED_FIELD_USED",
        message: `edits[${index}].targetStringBase64 is deprecated. Use edits[].targetSource with kind=base64 instead.`,
        details: { from: `edits[${index}].targetStringBase64`, to: "edits[].targetSource", kind: "base64" }
      });
      delete next.targetStringBase64;
    }
    if (hasTargetBase64) {
      findings.push({
        severity: "warning",
        code: "DEPRECATED_FIELD_USED",
        message: `edits[${index}].targetBase64 is deprecated. Use edits[].targetSource with kind=base64 instead.`,
        details: { from: `edits[${index}].targetBase64`, to: "edits[].targetSource", kind: "base64" }
      });
      delete next.targetBase64;
    }
    if (hasReplacementStringBase64) {
      findings.push({
        severity: "warning",
        code: "DEPRECATED_FIELD_USED",
        message: `edits[${index}].replacementStringBase64 is deprecated. Use edits[].replacementSource with kind=base64 instead.`,
        details: { from: `edits[${index}].replacementStringBase64`, to: "edits[].replacementSource", kind: "base64" }
      });
      delete next.replacementStringBase64;
    }
    if (hasReplacementBase64) {
      findings.push({
        severity: "warning",
        code: "DEPRECATED_FIELD_USED",
        message: `edits[${index}].replacementBase64 is deprecated. Use edits[].replacementSource with kind=base64 instead.`,
        details: { from: `edits[${index}].replacementBase64`, to: "edits[].replacementSource", kind: "base64" }
      });
      delete next.replacementBase64;
    }

    return next;
  });
};

const applyAliasKeys = (
  args: Record<string, any>,
  keys: string[],
  targetPath: string,
  findings: CompatFinding[],
  message: string
): void => {
  for (const key of keys) {
    const value = getPathValue(args, key);
    if (value === undefined) continue;
    applyAliasPath(args, key, targetPath, findings, message);
  }
};

const applyAliasPath = (
  args: Record<string, any>,
  fromPath: string,
  toPath: string,
  findings: CompatFinding[],
  message: string
): void => {
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
};

const schemaHasTopLevelProperty = (schema: ToolSpec["inputSchema"], key: string): boolean => {
  return Boolean(schema?.properties && Object.prototype.hasOwnProperty.call(schema.properties, key));
};

const schemaHasPath = (schema: ToolSpec["inputSchema"], path: string): boolean => {
  const parts = path.split(".");
  let current: any = schema;
  for (const part of parts) {
    if (!current?.properties) return false;
    const next = current.properties[part];
    if (!next) return false;
    current = next;
  }
  return true;
};

const coerceBoolean = (value: any): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
};
