import type { FileVersionManager } from "../../../engine/FileVersionManager.js";
import type { PathNormalizer } from "../../../utils/PathNormalizer.js";
import { buildDegradedReasons } from "../../DegradedReasonMapper.js";

export const buildFileVersionsSnapshot = async (
  filePaths: string[],
  fileVersionManager?: FileVersionManager,
  pathNormalizer?: PathNormalizer
): Promise<Record<string, { expectedVersion?: number; expectedHash?: string }> | undefined> => {
  if (!fileVersionManager || !pathNormalizer) return undefined;
  const snapshot: Record<string, { expectedVersion?: number; expectedHash?: string }> = {};
  const uniquePaths = Array.from(new Set(filePaths.filter(Boolean)));
  for (const filePath of uniquePaths) {
    const relPath = pathNormalizer.normalize(filePath);
    try {
      const absPath = pathNormalizer.toAbsolute(relPath);
      const versionInfo = await fileVersionManager.getVersion(absPath);
      snapshot[relPath] = {
        expectedVersion: versionInfo.version,
        expectedHash: versionInfo.contentHash
      };
    } catch {
      // skip missing files
    }
  }
  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
};

export const detectFileVersionMismatch = async (
  fileVersions: Record<string, { expectedVersion?: number; expectedHash?: string }>,
  fileVersionManager: FileVersionManager,
  pathNormalizer: PathNormalizer
): Promise<{ filePath: string } | null> => {
  for (const [relPath, expected] of Object.entries(fileVersions)) {
    if (!expected) continue;
    try {
      const absPath = pathNormalizer.toAbsolute(pathNormalizer.normalize(relPath));
      const current = await fileVersionManager.getVersion(absPath);
      if (typeof expected.expectedHash === "string" && expected.expectedHash.length > 0 && expected.expectedHash !== current.contentHash) {
        return { filePath: relPath };
      }
      if (typeof expected.expectedVersion === "number" && expected.expectedVersion !== current.version) {
        return { filePath: relPath };
      }
    } catch {
      return { filePath: relPath };
    }
  }
  return null;
};

export const buildFileVersionMismatchResponse = (args: {
  filePath: string;
  intent: string;
  writeMode: string;
  sessionId?: string;
  currentFileStates?: Record<string, { newVersion: number; newHash: string }>;
}) => {
  const degradedReasons = buildDegradedReasons(["file_version_mismatch"], { filePath: args.filePath });
  return {
    success: false,
    status: "blocked",
    createdFiles: [],
    transactionId: "",
    rollbackAvailable: false,
    writeMode: args.writeMode,
    errorCode: "FILE_VERSION_MISMATCH",
    blockedReason: "file_version_mismatch",
    degradedReasons,
    currentFileStates: args.currentFileStates,
    guidance: {
      message: "The file changed since it was read. Re-read and retry the write.",
      suggestedActions: [
        {
          id: "read.view_full",
          priority: 1,
          description: "Re-read the latest file content.",
          rationale: "Refresh context before reapplying the write.",
          tags: ["repair_ladder", "attempt_1"],
          toolCall: { tool: "read", args: { action: "view_full", target: args.filePath } }
        },
        {
          id: "write.plan",
          priority: 2,
          description: "Re-run the write in dry-run mode.",
          rationale: "Validate the write against the current file state.",
          tags: ["repair_ladder", "attempt_2"],
          toolCall: { tool: "write", args: { intent: args.intent, target: args.filePath, options: { dryRun: true } } }
        }
      ]
    },
    sessionId: args.sessionId
  };
};
