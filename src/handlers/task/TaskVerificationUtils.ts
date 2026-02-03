import type { HandlerContext } from "../HandlerContext.js";
import type { VerificationResult } from "./TaskTypes.js";

export const buildFileVersionsSnapshot = async (
    context: HandlerContext,
    paths: string[]
): Promise<Record<string, { expectedVersion?: number; expectedHash?: string }> | undefined> => {
    const fileVersionManager = context.fileVersionManager;
    const pathNormalizer = context.pathNormalizer;
    if (!fileVersionManager || !pathNormalizer) return undefined;
    const snapshot: Record<string, { expectedVersion?: number; expectedHash?: string }> = {};
    const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
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

export const buildVerificationResult = async (
    context: HandlerContext,
    args: {
        targetPath?: string;
        draftId?: string;
    }
): Promise<{ verification: VerificationResult; reasons: string[] }> => {
    const reasons: string[] = [];
    const verification: VerificationResult = {
        targetPath: args.targetPath,
        exists: false,
        draftId: args.draftId
    };
    if (!args.targetPath) {
        reasons.push("file_missing");
        return { verification, reasons };
    }
    const pathNormalizer = context.pathNormalizer;
    let relPath = args.targetPath;
    if (pathNormalizer) {
        try {
            relPath = pathNormalizer.normalize(args.targetPath);
        } catch {
            reasons.push("file_missing");
            return { verification, reasons };
        }
    }
    verification.relPath = relPath;
    const fileSystem = context.fileSystem;
    let fileContent: string | undefined;
    try {
        fileContent = await fileSystem.readFile(relPath);
        verification.exists = true;
    } catch {
        verification.exists = false;
        reasons.push("file_missing");
    }
    let draftPack: any;
    if (args.draftId) {
        const draftArtifact = context.flowArtifactManager?.get(args.draftId);
        draftPack = draftArtifact?.type === "draft" ? (draftArtifact as any).pack : undefined;
        verification.draftFound = Boolean(draftPack);
        if (!draftPack) {
            reasons.push("draft_missing");
        }
    }
    let draftContent: string | undefined;
    if (draftPack?.phantomFiles?.length) {
        const match = draftPack.phantomFiles.find((file: any) => {
            if (!file?.path) return false;
            if (!pathNormalizer) return file.path === relPath;
            try {
                return pathNormalizer.normalize(file.path) === relPath;
            } catch {
                return file.path === relPath;
            }
        });
        if (match && typeof match.content === "string") {
            draftContent = match.content;
        }
    }
    if (verification.exists && draftContent !== undefined) {
        verification.contentMatch = fileContent === draftContent;
        if (verification.contentMatch === false) {
            reasons.push("content_mismatch");
        }
    }
    const expectedVersion = draftPack?.fileVersions?.[relPath];
    const shouldCheckBaseVersion = verification.exists
        && verification.contentMatch !== true
        && expectedVersion
        && context.fileVersionManager
        && pathNormalizer;
    if (shouldCheckBaseVersion) {
        try {
            const absPath = pathNormalizer.toAbsolute(relPath);
            const currentVersion = await context.fileVersionManager!.getVersion(absPath);
            if (expectedVersion.expectedHash) {
                verification.fileVersionMatch = currentVersion.contentHash === expectedVersion.expectedHash;
            } else if (expectedVersion.expectedVersion !== undefined) {
                verification.fileVersionMatch = currentVersion.version === expectedVersion.expectedVersion;
            }
            if (verification.fileVersionMatch === false) {
                reasons.push("file_version_mismatch");
            }
        } catch {
            // ignore version read failures
        }
    }
    return { verification, reasons };
};
