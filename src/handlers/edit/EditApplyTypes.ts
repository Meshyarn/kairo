import type { HandlerContext } from "../HandlerContext.js";

export type EditApplyDeps = {
  context: HandlerContext;
  resolveRelativePath: (inputPath: string) => string;
  resolveAbsolutePath: (inputPath: string) => string;
  computeHash: (content: string, algorithm?: "sha256" | "xxhash") => string;
  normalizeEditPayload: (edit: any) => any;
  readExists: (relPath: string) => Promise<boolean>;
  normalizeFileVersions: (raw: any) => Map<string, { expectedVersion?: number; expectedHash?: string }>;
  findFileVersionMismatches: (
    operationsByFile: Map<string, Set<string>>,
    fileVersions: Map<string, { expectedVersion?: number; expectedHash?: string }>
  ) => Promise<Array<{ filePath: string; current?: { version: number; contentHash: string }; reason: string }>>;
  buildFileVersionMismatchResponse: (
    mismatches: Array<{ filePath: string; current?: { version: number; contentHash: string } }>,
    operationsByFile?: Map<string, Set<string>>
  ) => any;
  collectUpdatedFileStates: (paths: string[]) => Promise<Record<string, { newVersion: number; newHash: string }>>;
};

export type EditOperation = {
  operation: "create" | "replace" | "delete";
  filePath: string;
  absPath: string;
  edits?: any[];
  content?: string;
  confirmationHash?: any;
};
