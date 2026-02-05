// Context:
// EditorEngine (handles file I/O, diffs, backups, applyEdits)
// HistoryEngine (handles history.json, undo/redo stacks)
// EditCoordinator needs to coordinate these two.

import * as path from "path";
import { EditorEngine } from "./Editor.js";
import { HistoryEngine } from "./History.js";
import { ImpactAnalyzer } from "./ImpactAnalyzer.js";
import {
    Edit,
    EditResult,
    EditOperation,
    BatchOperation,
    HistoryItem,
    FileOperation,
    HistoryOperation,
    EditExecutionOptions,
    ImpactPreview,
    ResolvedEdit
} from "../types.js";
import { IFileSystem } from "../platform/FileSystem.js";
import { TransactionLog, TransactionSnapshot } from "./TransactionLog.js";
import {
    buildBatchFailure,
    computeHash,
    generateTransactionId,
    normalizeBatchFailure,
    resolveFilePath,
    restoreSnapshots
} from "./EditCoordinatorUtils.js";

interface EditCoordinatorInitOptions {
    rootPath?: string;
    transactionLog: TransactionLog;
    fileSystem: IFileSystem;
    impactAnalyzer?: ImpactAnalyzer;
}

export class EditCoordinator {
    private editorEngine: EditorEngine;
    private historyEngine: HistoryEngine;
    private rootPath?: string;
    private readonly fileSystem?: IFileSystem;
    private readonly transactionLog?: TransactionLog;
    private readonly impactAnalyzer?: ImpactAnalyzer;

    /**
     * @param editorEngine EditorEngine instance (expects absolute file paths)
     * @param historyEngine HistoryEngine instance (stores filePath relative to root)
     * @param rootPathOrOptions Either the legacy root path string or an options object enabling transactions
     */
    constructor(
        editorEngine: EditorEngine,
        historyEngine: HistoryEngine,
        rootPathOrOptions?: string | EditCoordinatorInitOptions
    ) {
        this.editorEngine = editorEngine;
        this.historyEngine = historyEngine;
        if (typeof rootPathOrOptions === "string" || rootPathOrOptions === undefined) {
            this.rootPath = rootPathOrOptions;
        } else {
            this.rootPath = rootPathOrOptions.rootPath;
            this.transactionLog = rootPathOrOptions.transactionLog;
            this.fileSystem = rootPathOrOptions.fileSystem;
            this.impactAnalyzer = rootPathOrOptions.impactAnalyzer;
        }
    }

    public getTransactionLog(): TransactionLog | undefined {
        return this.transactionLog;
    }

    /**
     * Apply edits to a file and, if not a dry run, record the operation in history.
     *
     * - Calls EditorEngine.applyEdits(filePath, edits, dryRun).
     * - If successful and not dryRun, pushes the returned operation (if any) to HistoryEngine.
     * - Returns the EditResult from EditorEngine.
     */
    public async applyEdits(
        filePath: string,
        edits: Edit[],
        dryRun: boolean = false,
        options?: EditExecutionOptions
    ): Promise<EditResult> {
        const result = options?.diffMode
            ? await this.editorEngine.applyEdits(filePath, edits, dryRun, options)
            : await this.editorEngine.applyEdits(filePath, edits, dryRun);

        if (result.success && !dryRun && result.operation) {
            await this.historyEngine.pushOperation(result.operation as EditOperation);
        }

        if (result.success && dryRun && this.impactAnalyzer && !options?.skipImpactPreview) {
            result.impactPreview = await this.impactAnalyzer.analyzeImpact(filePath, edits);
        }

        return result;
    }

    // ADR-042-005: Phase B1 - Apply ResolvedEdits
    /**
     * Apply resolved edits (indexRange-based) to a file.
     * 
     * ResolvedEdits are already validated by EditResolver and contain exact indexRanges,
     * so this method directly converts them to Edit format and applies them.
     * 
     * @param absPath Absolute file path
     * @param resolvedEdits Array of ResolvedEdit from Resolver
     * @param dryRun If true, performs dry-run without modifying files
     * @param options Execution options (diffMode, skipImpactPreview, etc.)
     * @returns EditResult with operation details
     */
    public async applyResolvedEdits(
        absPath: string,
        resolvedEdits: ResolvedEdit[],
        dryRun: boolean = false,
        options?: EditExecutionOptions
    ): Promise<EditResult> {
        // Convert ResolvedEdit to Edit format
        const edits: Edit[] = resolvedEdits.map(re => ({
            targetString: re.targetString,
            replacementString: re.replacementString,
            indexRange: re.indexRange,
            expectedHash: re.expectedHash
        }));

        // Use existing applyEdits method
        const result = await this.applyEdits(absPath, edits, dryRun, options);

        // Attach resolution diagnostics to result if available
        if (result.success && resolvedEdits.length > 0 && resolvedEdits[0].diagnostics) {
            (result as any).resolutionDiagnostics = resolvedEdits.map(re => re.diagnostics);
        }

        return result;
    }

    /**
     * Apply batch of resolved edits across multiple files.
     * 
     * @param fileResolvedEdits Array of {filePath, resolvedEdits}
     * @param dryRun If true, performs dry-run
     * @param options Execution options
     * @returns EditResult with batch operation details
     */
    public async applyBatchResolvedEdits(
        fileResolvedEdits: { filePath: string; resolvedEdits: ResolvedEdit[] }[],
        dryRun: boolean = false,
        options?: EditExecutionOptions
    ): Promise<EditResult> {
        // Convert to Edit format for batch processing
        const fileEdits = fileResolvedEdits.map(({ filePath, resolvedEdits }) => ({
            filePath,
            edits: resolvedEdits.map(re => ({
                targetString: re.targetString,
                replacementString: re.replacementString,
                indexRange: re.indexRange,
                expectedHash: re.expectedHash
            } as Edit))
        }));

        // Use existing batch method
        return this.applyBatchEdits(fileEdits, dryRun, options);
    }

    /**
     * Apply a batch of edits across multiple files as a single logical operation.
     *
     * - If dryRun is true, verifies that all edits can be applied without writing or touching history.
     * - If dryRun is false, applies all edits and rolls back previously applied ones if any file fails.
     * - On full success, pushes a BatchOperation to history and returns a combined EditResult.
     */
    public async applyBatchEdits(
        fileEdits: { filePath: string; edits: Edit[] }[],
        dryRun: boolean = false,
        options?: EditExecutionOptions
    ): Promise<EditResult> {
        const invokeApply = (targetPath: string, targetEdits: Edit[], isDryRun: boolean) => {
            if (options?.diffMode) {
                return this.editorEngine.applyEdits(targetPath, targetEdits, isDryRun, options);
            }
            return this.editorEngine.applyEdits(targetPath, targetEdits, isDryRun);
        };

        if (fileEdits.length === 0) {
            return { success: true, message: "No edits provided." };
        }

        if (dryRun) {
            for (const { filePath, edits } of fileEdits) {
                const result = await invokeApply(filePath, edits, true);
                if (!result.success) {
                    return {
                        ...result,
                        success: false,
                        message: `Dry run failed for file ${filePath}: ${result.message ?? "Unknown error"}`,
                        errorCode: result.errorCode ?? "BatchDryRunFailed",
                    };
                }
            }

            const impactPreviews: ImpactPreview[] = [];
            if (this.impactAnalyzer) {
                for (const { filePath, edits } of fileEdits) {
                    const preview = await this.impactAnalyzer.analyzeImpact(filePath, edits);
                    impactPreviews.push(preview);
                }
            }

            return {
                success: true,
                message: `Dry run successful for ${fileEdits.length} file(s).`,
                impactPreviews: impactPreviews.length > 0 ? impactPreviews : undefined
            };
        }

        if (!this.transactionLog || !this.fileSystem) {
            return this.applyBatchWithoutTransactions(fileEdits, invokeApply);
        }

        return this.applyBatchWithTransactions(fileEdits, invokeApply);
    }

    private async applyBatchWithoutTransactions(
        fileEdits: { filePath: string; edits: Edit[] }[],
        invokeApply: (filePath: string, edits: Edit[], dryRun: boolean) => Promise<EditResult>
    ): Promise<EditResult> {
        const applied: { filePath: string; operation: EditOperation }[] = [];

        for (const { filePath, edits } of fileEdits) {
            const result = await invokeApply(filePath, edits, false);

            if (!result.success || !result.operation) {
                // Rollback previously applied edits in this batch
                const errors = [`Failed to apply edits to ${filePath}: ${result.message ?? "Unknown error"}`];
                for (let i = applied.length - 1; i >= 0; i--) {
                    const entry = applied[i];
                    const rbResult = await invokeApply(entry.filePath, entry.operation.inverseEdits as Edit[], false);
                    if (!rbResult.success) {
                        errors.push(`Critical: Failed to rollback ${entry.filePath}: ${rbResult.message ?? "Unknown error"}`);
                    }
                }
                return {
                    success: false,
                    message: errors.join("\n"),
                    errorCode: result.errorCode ?? "BatchApplyFailed",
                };
            }

            applied.push({ filePath, operation: result.operation as EditOperation });
        }

        const batchOperation: BatchOperation = {
            id: generateTransactionId(),
            timestamp: Date.now(),
            description: `Batch operation on ${applied.length} file(s).`,
            operations: applied.map((entry) => entry.operation),
        };

        await this.historyEngine.pushOperation(batchOperation as HistoryItem);

        return {
            success: true,
            message: `Successfully applied batch edits to ${applied.length} file(s).`,
        };
    }

    private async applyBatchWithTransactions(
        fileEdits: { filePath: string; edits: Edit[] }[],
        invokeApply: (filePath: string, edits: Edit[], dryRun: boolean) => Promise<EditResult>
    ): Promise<EditResult> {
        const transactionLog = this.transactionLog!;
        const fileSystem = this.fileSystem!;
        const transactionId = generateTransactionId();
        const description = `Batch operation on ${fileEdits.length} file(s).`;

        const snapshots: TransactionSnapshot[] = [];
        const snapshotMap = new Map<string, TransactionSnapshot>();

        for (const { filePath } of fileEdits) {
            const originalContent = await fileSystem.readFile(filePath);
            const snapshot: TransactionSnapshot = {
                filePath,
                originalExists: true,
                originalContent,
                originalHash: computeHash(originalContent),
            };
            snapshots.push(snapshot);
            snapshotMap.set(filePath, snapshot);
        }

        transactionLog.begin(transactionId, description, snapshots);
        await this.historyEngine.pushOperation({
            id: transactionId,
            timestamp: Date.now(),
            description,
            operations: []
        } as BatchOperation);

        const operations: EditOperation[] = [];

        try {
            for (const { filePath, edits } of fileEdits) {
                const result = await invokeApply(filePath, edits, false);

                if (!result.success || !result.operation) {
                    throw buildBatchFailure(filePath, result);
                }

                operations.push(result.operation as EditOperation);

                const newContent = await fileSystem.readFile(filePath);
                const snapshot = snapshotMap.get(filePath);
                if (snapshot) {
                    snapshot.newExists = true;
                    snapshot.newContent = newContent;
                    snapshot.newHash = computeHash(newContent);
                }
            }

            const batchOperation: BatchOperation = {
                id: transactionId,
                timestamp: Date.now(),
                description,
                operations,
            };

            await transactionLog.commit(transactionId, snapshots, { operations });
            await this.historyEngine.replaceOperation(transactionId, batchOperation as HistoryItem);

            return {
                success: true,
                message: `Successfully applied batch edits to ${operations.length} file(s).`,
            };
        } catch (error) {
            await restoreSnapshots(snapshots, this.fileSystem);
            transactionLog.rollback(transactionId);
            await this.historyEngine.removeOperation(transactionId);

                const failure = normalizeBatchFailure(error);
            return {
                success: false,
                message: failure.message,
                errorCode: failure.errorCode ?? "BatchApplyFailed",
            };
        }
    }

    /**
     * Undo the last edit operation using the stored inverse edits.
     *
     * - Calls HistoryEngine.undo().
     * - If no operation is available, returns an error EditResult.
     * - If an operation exists, resolves its filePath (relative to root) back to an absolute path.
     * - Calls EditorEngine.applyEdits(resolvedPath, op.inverseEdits, false).
     * - Returns the EditResult from EditorEngine.
     */
    public async undo(): Promise<EditResult> {
        const item = (await this.historyEngine.undo()) as HistoryItem | null;

        if (!item) {
            return {
                success: false,
                message: "No operation to undo.",
            };
        }

        // BatchOperation: undo each contained operation in reverse order.
        if ((item as BatchOperation).operations) {
            const batch = item as BatchOperation;
            for (let i = batch.operations.length - 1; i >= 0; i--) {
                const op = batch.operations[i];
                const result = await this.applyHistoryOperation(op, "undo");
                if (!result.success) {
                    return {
                        success: false,
                        message: `Failed to undo part of batch: ${result.message}`,
                    };
                }
            }
            return { success: true, message: "Successfully undid batch operation." };
        } else {
            const op = item as HistoryOperation;
            return this.applyHistoryOperation(op, "undo");
        }
    }

    /**
     * Redo the last undone edit operation using the stored forward edits.
     *
     * - Calls HistoryEngine.redo().
     * - If no operation is available, returns an error EditResult.
     * - If an operation exists, resolves its filePath (relative to root) back to an absolute path.
     * - Calls EditorEngine.applyEdits(resolvedPath, op.edits, false).
     * - Returns the EditResult from EditorEngine.
     */
    public async redo(): Promise<EditResult> {
        const item = (await this.historyEngine.redo()) as HistoryItem | null;

        if (!item) {
            return {
                success: false,
                message: "No operation to redo.",
            };
        }

        // BatchOperation: redo each contained operation in original order.
        if ((item as BatchOperation).operations) {
            const batch = item as BatchOperation;
            for (const op of batch.operations) {
                const result = await this.applyHistoryOperation(op, "redo");
                if (!result.success) {
                    return {
                        success: false,
                        message: `Failed to redo part of batch: ${result.message}`,
                    };
                }
            }
            return { success: true, message: "Successfully redid batch operation." };
        } else {
            const op = item as HistoryOperation;
            return this.applyHistoryOperation(op, "redo");
        }
    }

    private isFileOperation(op: HistoryOperation): op is FileOperation {
        return (op as FileOperation).type === "file";
    }

    private async applyHistoryOperation(op: HistoryOperation, mode: "undo" | "redo"): Promise<EditResult> {
        if (this.isFileOperation(op)) {
            return this.applyFileOperation(op, mode);
        }
        const resolvedPath = resolveFilePath(op.filePath!, this.rootPath);
        const edits = mode === "undo" ? (op.inverseEdits as Edit[]) : (op.edits as Edit[]);
        return this.editorEngine.applyEdits(resolvedPath, edits, false);
    }

    private async applyFileOperation(op: FileOperation, mode: "undo" | "redo"): Promise<EditResult> {
        if (!this.fileSystem) {
            return { success: false, message: "File system unavailable for undo/redo." };
        }
        const resolvedPath = resolveFilePath(op.filePath, this.rootPath);
        const shouldDelete = (op.action === "create" && mode === "undo") || (op.action === "delete" && mode === "redo");
        if (shouldDelete) {
            try {
                if (await this.fileSystem.exists(resolvedPath)) {
                    await this.fileSystem.deleteFile(resolvedPath);
                }
                return { success: true, message: "File deletion completed." };
            } catch (error: any) {
                return { success: false, message: error?.message ?? "File deletion failed." };
            }
        }
        if (typeof op.content !== "string") {
            return { success: false, message: "Missing content to restore file." };
        }
        try {
            const dir = path.dirname(resolvedPath);
            await this.fileSystem.createDir(dir);
            await this.fileSystem.writeFile(resolvedPath, op.content);
            return { success: true, message: "File restoration completed." };
        } catch (error: any) {
            return { success: false, message: error?.message ?? "File restoration failed." };
        }
    }

}
