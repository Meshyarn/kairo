export type ContractManifestKind =
  | "ffi_napi"
  | "ffi_jni"
  | "ffi_cgo"
  | "ffi_python_ext"
  | "ffi_php_ext"
  | "idl_proto"
  | "http_openapi"
  | "db_sql_schema";

export type ContractManifestHeader = {
  version: "1.0";
  kind: ContractManifestKind;
  id: string;
  module?: string;
  sourceRepo: string;
  generatedAt: number;
  evidence?: Array<{ path: string; type: string; note?: string }>;
};

export type ContractField = {
  name: string;
  type: string;
};

export type ContractMethod = {
  name: string;
  signature: string;
};

export type ContractExport = {
  name: string;
  kind: "interface" | "class" | "function";
  fields?: ContractField[];
  methods?: ContractMethod[];
  signature?: string;
};

export type ContractSurface =
  | { kind: "ffi_napi"; exports: Record<string, ContractExport | unknown> }
  | { kind: "idl_proto"; packages: string[]; services: Record<string, unknown>; messages: Record<string, unknown> }
  | { kind: "http_openapi"; title?: string; version?: string; operations: Record<string, unknown> }
  | { kind: "db_sql_schema"; dialect?: string; tables: Record<string, unknown> };

export type ContractManifest = {
  header: ContractManifestHeader;
  surface: ContractSurface;
};
