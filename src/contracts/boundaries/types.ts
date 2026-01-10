import type { RepoRegistry } from "../../config/RepoRegistry.js";

export type BoundaryKind =
  | "ffi_napi"
  | "ffi_jni"
  | "ffi_cgo"
  | "ffi_python_ext"
  | "ffi_php_ext"
  | "idl_proto"
  | "http_openapi"
  | "db_sql_schema";

export type BoundaryEvidence = {
  path: string;
  type: string;
  note?: string;
};

export type BoundaryInstance = {
  id: string;
  kind: BoundaryKind;
  producerRepoId: string;
  consumerRepoIds: string[];
  evidence: BoundaryEvidence[];
  confidence: "high" | "medium" | "low";
};

export type ContractManifestHeader = {
  version: "1.0";
  kind: BoundaryKind;
  id: string;
  module?: string;
  sourceRepo: string;
  generatedAt: number;
  evidence: BoundaryEvidence[];
};

export type ContractSurface =
  | { kind: "ffi_napi"; exports: Record<string, unknown> }
  | { kind: "idl_proto"; packages: string[]; services: Record<string, unknown>; messages: Record<string, unknown> }
  | { kind: "http_openapi"; title?: string; version?: string; operations: Record<string, unknown> }
  | { kind: "db_sql_schema"; dialect?: string; tables: Record<string, unknown> };

export type ContractManifest = {
  header: ContractManifestHeader;
  surface: ContractSurface;
};

export type ContractLoadResult = {
  manifest?: ContractManifest;
  degraded?: boolean;
  reasons: string[];
};

export type BoundaryAdapter = {
  readonly kind: BoundaryKind;
  discover(root: string, repoRegistry: RepoRegistry): Promise<BoundaryInstance[]>;
  loadOrGenerate(instance: BoundaryInstance): Promise<ContractLoadResult>;
};
