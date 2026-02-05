import * as crypto from "crypto";
import * as path from "path";
import { createRequire } from "module";
import type { IFileSystem } from "../platform/FileSystem.js";
import type { TransactionSnapshot } from "./TransactionLog.js";
import { metrics } from "../utils/MetricsCollector.js";
import type { EditResult } from "../types.js";

interface BatchFailure {
    message: string;
    errorCode?: string;
}

const require = createRequire(import.meta.url);
let importedXxhash: any = null;
try {
    importedXxhash = require("xxhashjs");
} catch {
    importedXxhash = null;
}
const XXH: any = importedXxhash ? (importedXxhash.default ?? importedXxhash) : null;

export const computeHash = (content: string): string => {
    if (XXH) {
        return XXH.h64(0xABCD).update(content).digest().toString(16);
    }
    return crypto.createHash("sha256").update(content).digest("hex");
};

export const generateTransactionId = (): string => {
    try {
        return crypto.randomUUID();
    } catch {
        return `tx-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
};

export const resolveFilePath = (storedPath: string, rootPath?: string): string => {
    if (path.isAbsolute(storedPath)) {
        return storedPath;
    }

    if (rootPath) {
        return path.join(rootPath, storedPath);
    }

    return path.resolve(storedPath);
};

export const restoreSnapshots = async (
    snapshots: TransactionSnapshot[],
    fileSystem: IFileSystem | undefined
): Promise<void> => {
    if (!fileSystem) {
        return;
    }

    for (const snapshot of snapshots) {
        try {
            if (snapshot.originalExists === false) {
                if (await fileSystem.exists(snapshot.filePath)) {
                    await fileSystem.deleteFile(snapshot.filePath);
                }
            } else {
                await fileSystem.writeFile(snapshot.filePath, snapshot.originalContent);
                const restored = await fileSystem.readFile(snapshot.filePath);
                const restoredHash = computeHash(restored);
                if (restoredHash !== snapshot.originalHash) {
                    console.error(`[EditCoordinator] Hash mismatch after rollback for ${snapshot.filePath}`);
                    metrics.inc("transactions.hash_mismatch");
                }
            }
        } catch (error) {
            console.error(`[EditCoordinator] Failed to restore ${snapshot.filePath}:`, error);
        }
    }
};

export const buildBatchFailure = (filePath: string, result: EditResult): BatchFailure => {
    return {
        message: `Batch edit failed for file ${filePath}: ${result.message ?? "Unknown error"}`,
        errorCode: result.errorCode ?? "BatchApplyFailed"
    };
};

export const normalizeBatchFailure = (error: unknown): BatchFailure => {
    if (error && typeof error === "object" && "message" in error) {
        const maybeFailure = error as BatchFailure & { message?: string };
        return {
            message: maybeFailure.message || "Unknown batch error",
            errorCode: maybeFailure.errorCode
        };
    }
    return { message: String(error) };
};
