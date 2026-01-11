import type { ContractManifest, ContractSurface } from "./boundaries/types.js";

export type ContractDiff = {
  added: string[];
  removed: string[];
  changed: Array<{
    exportName: string;
    kind: "signature" | "field" | "method" | "unknown";
    before: unknown;
    after: unknown;
    breaking: boolean;
  }>;
  degraded: boolean;
  reasons: string[];
};

export function diffManifests(
  before: ContractManifest | undefined,
  after: ContractManifest | undefined
): ContractDiff {
  if (!before || !after) {
    return {
      added: [],
      removed: [],
      changed: [],
      degraded: true,
      reasons: ["contract_manifest_missing"]
    };
  }

  const beforeMap = extractSurfaceMap(before.surface);
  const afterMap = extractSurfaceMap(after.surface);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: ContractDiff["changed"] = [];

  for (const key of Object.keys(afterMap)) {
    if (!(key in beforeMap)) {
      added.push(key);
      continue;
    }
    const beforeValue = beforeMap[key];
    const afterValue = afterMap[key];
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      const kind = classifyChangeKind(beforeValue, afterValue);
      changed.push({
        exportName: key,
        kind,
        before: beforeValue,
        after: afterValue,
        breaking: true
      });
    }
  }

  for (const key of Object.keys(beforeMap)) {
    if (!(key in afterMap)) {
      removed.push(key);
    }
  }

  return {
    added,
    removed,
    changed,
    degraded: false,
    reasons: []
  };
}

export const diffContracts = diffManifests;

function extractSurfaceMap(surface: ContractSurface): Record<string, unknown> {
  if (surface.kind === "ffi_napi") return surface.exports ?? {};
  if (surface.kind === "idl_proto") return surface.services ?? {};
  if (surface.kind === "http_openapi") return surface.operations ?? {};
  if (surface.kind === "db_sql_schema") return surface.tables ?? {};
  return {};
}

function classifyChangeKind(beforeValue: any, afterValue: any): "signature" | "field" | "method" | "unknown" {
  const beforeKind = beforeValue?.kind;
  const afterKind = afterValue?.kind;
  const kind = beforeKind || afterKind;
  if (kind === "interface") return "field";
  if (kind === "class") return "method";
  if (kind === "function") return "signature";
  return "unknown";
}
