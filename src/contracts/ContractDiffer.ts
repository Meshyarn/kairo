import type { ContractManifest, ContractSurface } from "./boundaries/types.js";

export type ContractDiff = {
  added: string[];
  removed: string[];
  changed: Array<{
    key: string;
    before: unknown;
    after: unknown;
  }>;
  degraded: boolean;
  reasons: string[];
};

export function diffContracts(
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
      changed.push({ key, before: beforeValue, after: afterValue });
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

function extractSurfaceMap(surface: ContractSurface): Record<string, unknown> {
  if (surface.kind === "ffi_napi") return surface.exports ?? {};
  if (surface.kind === "idl_proto") return surface.services ?? {};
  if (surface.kind === "http_openapi") return surface.operations ?? {};
  if (surface.kind === "db_sql_schema") return surface.tables ?? {};
  return {};
}
