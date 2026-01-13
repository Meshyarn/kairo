import { BaseHandler } from "./BaseHandler.js";
import { HandlerContext } from "./HandlerContext.js";
import { createRequire } from "module";
import * as path from "path";
import * as crypto from "crypto";

const require = createRequire(import.meta.url);
let importedXxhash: any = null;
try {
    importedXxhash = require("xxhashjs");
} catch {
    importedXxhash = null;
}
const XXH: any = importedXxhash ? (importedXxhash.default ?? importedXxhash) : null;

export class EditHandlers extends BaseHandler {
    constructor(private context: HandlerContext) {
        super();
    }

    async handle(name: string, args: any): Promise<any> {
        const pillarTools = new Set(['change', 'write']);
        const internalTools = new Set(['edit_apply', 'file_edit', 'edit_transaction', 'edit_guidance', 'file_write']);

        if (pillarTools.has(name)) {
            const requiredMap: Record<string, string[]> = {
                change: ['intent'],
                write: ['intent']
            };
            const missing = this.validateRequiredArgs(name, args, requiredMap);
            if (missing.length > 0) {
                return this.errorResponse("MissingParameter", `Missing required parameter(s): ${missing.join(', ')}`);
            }
            const result = await this.context.orchestrationEngine.executePillar(name, args);
            return this.jsonResponse(result);
        }

        if (internalTools.has(name)) {
            const requiredMap: Record<string, string[]> = {
                edit_apply: ['edits'],
                file_edit: ['filePath', 'edits'],
                edit_transaction: ['edits'],
                edit_guidance: ['filePaths'],
                file_write: ['filePath', 'content']
            };
            const missing = this.validateRequiredArgs(name, args, requiredMap);
            if (missing.length > 0) {
                return this.errorResponse("MissingParameter", `Missing required parameter(s): ${missing.join(', ')}`);
            }

            switch (name) {
                case 'edit_apply':
                    return this.jsonResponse(await this.editCodeRaw(args));
                case 'file_edit': {
                    const result = await this.editFileRaw(args);
                    return {
                        isError: !result.success,
                        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
                    };
                }
                case 'edit_transaction':
                    return this.jsonResponse(await this.executeEditCoordinator(args));
                case 'edit_guidance':
                    return this.jsonResponse(await this.executeGetBatchGuidance(args));
                case 'file_write':
                    return this.jsonResponse(await this.executeWriteFile(args));
                default:
                    break;
            }
        }
        return null;
    }

    private resolveRelativePath(inputPath: string): string {
        return this.context.pathNormalizer.normalize(inputPath);
    }

    private resolveAbsolutePath(inputPath: string): string {
        return this.context.pathNormalizer.toAbsolute(this.resolveRelativePath(inputPath));
    }

    private computeHash(content: string, algorithm: 'sha256' | 'xxhash' = 'sha256'): string {
        if (algorithm === 'xxhash' && XXH) {
            return XXH.h64(0xABCD).update(content).digest().toString(16);
        }
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    private supportsGetVersion(): boolean {
        return typeof (this.context as any)?.fileVersionManager?.getVersion === "function";
    }

    private supportsIncrementVersion(): boolean {
        return typeof (this.context as any)?.fileVersionManager?.incrementVersion === "function";
    }

    private async readExists(relPath: string): Promise<boolean> {
        const exists = (this.context as any)?.fileSystem?.exists;
        if (typeof exists === "function") {
            return Boolean(await exists(relPath).catch(() => false));
        }
        const stat = (this.context as any)?.fileSystem?.stat;
        if (typeof stat === "function") {
            try {
                await stat(relPath);
                return true;
            } catch {
                return false;
            }
        }
        return false;
    }

    private async getCurrentFileState(relPath: string, absPath: string, contentHint?: string): Promise<{ newVersion: number; newHash: string } | undefined> {
        if (this.supportsGetVersion()) {
            const versionInfo = await (this.context as any).fileVersionManager.getVersion(absPath);
            return { newVersion: versionInfo.version, newHash: versionInfo.contentHash };
        }
        if (this.supportsIncrementVersion() && typeof contentHint === "string") {
            const versionInfo = (this.context as any).fileVersionManager.incrementVersion(absPath, contentHint);
            if (!versionInfo || typeof versionInfo.version !== "number" || typeof versionInfo.contentHash !== "string") {
                return undefined;
            }
            return { newVersion: versionInfo.version, newHash: versionInfo.contentHash };
        }
        return undefined;
    }

    private normalizeFileVersions(raw: any): Map<string, { expectedVersion?: number; expectedHash?: string }> {
        const normalized = new Map<string, { expectedVersion?: number; expectedHash?: string }>();
        if (!raw || typeof raw !== 'object') {
            return normalized;
        }
        for (const [key, value] of Object.entries(raw)) {
            if (!key) continue;
            const relPath = this.resolveRelativePath(key);
            if (!relPath) continue;
            const expectedVersion = typeof (value as any)?.expectedVersion === 'number' ? (value as any).expectedVersion : undefined;
            const expectedHash = typeof (value as any)?.expectedHash === 'string' ? (value as any).expectedHash : undefined;
            if (expectedVersion === undefined && expectedHash === undefined) continue;
            normalized.set(relPath, { expectedVersion, expectedHash });
        }
        return normalized;
    }

    private async collectUpdatedFileStates(paths: string[]): Promise<Record<string, { newVersion: number; newHash: string }>> {
        const updated: Record<string, { newVersion: number; newHash: string }> = {};
        const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
        for (const relPath of uniquePaths) {
            const exists = await this.readExists(relPath);
            if (!exists) continue;
            const absPath = this.resolveAbsolutePath(relPath);
            const state = await this.getCurrentFileState(relPath, absPath);
            if (!state) continue;
            updated[relPath] = state;
        }
        return updated;
    }

    private async findFileVersionMismatches(
        operationsByFile: Map<string, Set<string>>,
        fileVersions: Map<string, { expectedVersion?: number; expectedHash?: string }>
    ): Promise<Array<{ filePath: string; current?: { version: number; contentHash: string }; reason: string }>> {
        const mismatches: Array<{ filePath: string; current?: { version: number; contentHash: string }; reason: string }> = [];
        if (fileVersions.size === 0) return mismatches;
        if (!this.supportsGetVersion()) return mismatches;
        for (const [filePath, expected] of fileVersions.entries()) {
            if (!operationsByFile.has(filePath)) continue;
            const operations = operationsByFile.get(filePath) ?? new Set();
            const absPath = this.resolveAbsolutePath(filePath);
            let current: any;
            try {
                current = await (this.context as any).fileVersionManager.getVersion(absPath);
            } catch {
                if (operations.has('create')) {
                    continue;
                }
                mismatches.push({ filePath, reason: 'missing_file' });
                continue;
            }
            if (expected.expectedHash !== undefined && current.contentHash !== expected.expectedHash) {
                mismatches.push({ filePath, current: { version: current.version, contentHash: current.contentHash }, reason: 'hash_mismatch' });
                continue;
            }
            if (expected.expectedVersion !== undefined && current.version !== expected.expectedVersion) {
                mismatches.push({ filePath, current: { version: current.version, contentHash: current.contentHash }, reason: 'version_mismatch' });
            }
        }
        return mismatches;
    }

    private buildFileVersionMismatchResponse(mismatches: Array<{ filePath: string; current?: { version: number; contentHash: string } }>) {
        const updatedFileStates: Record<string, { newVersion: number; newHash: string }> = {};
        for (const mismatch of mismatches) {
            if (mismatch.current) {
                updatedFileStates[mismatch.filePath] = {
                    newVersion: mismatch.current.version,
                    newHash: mismatch.current.contentHash
                };
            }
        }
        return {
            success: false,
            errorCode: "FILE_VERSION_MISMATCH",
            message: "File version mismatch detected. Re-read the file(s) and retry the edit.",
            results: mismatches.map((mismatch) => ({
                filePath: mismatch.filePath,
                applied: false,
                error: "FILE_VERSION_MISMATCH",
                nextActionHint: { suggestReRead: true }
            })),
            updatedFileStates: Object.keys(updatedFileStates).length > 0 ? updatedFileStates : undefined
        };
    }

    private async editCodeRaw(args: any) {
        const edits = Array.isArray(args?.edits) ? args.edits : [];
        if (edits.length === 0) {
            return { success: false, results: [], message: "No edits provided." };
        }

        const dryRun = Boolean(args?.dryRun);
        const diffMode = args?.diffMode;
        const createMissingDirectories = Boolean(args?.createMissingDirectories);
        const results: any[] = [];

        const editsByFile = new Map<string, any[]>();
        const operationsByFile = new Map<string, Set<string>>();
        const createOps: any[] = [];
        const deleteOps: any[] = [];
        const addOperation = (filePath: string, operation: string) => {
            const list = operationsByFile.get(filePath) ?? new Set<string>();
            list.add(operation);
            operationsByFile.set(filePath, list);
        };

        for (const edit of edits) {
            if (!edit?.filePath) {
                continue;
            }
            if (edit.operation === 'create') {
                const relPath = this.resolveRelativePath(edit.filePath);
                addOperation(relPath, 'create');
                createOps.push(edit);
                continue;
            }
            if (edit.operation === 'delete') {
                const relPath = this.resolveRelativePath(edit.filePath);
                addOperation(relPath, 'delete');
                deleteOps.push(edit);
                continue;
            }
            const filePath = this.resolveRelativePath(edit.filePath);
            addOperation(filePath, edit.operation ?? 'replace');
            const fileEdits = editsByFile.get(filePath) ?? [];
            fileEdits.push({
                targetString: edit.targetString ?? "",
                replacementString: edit.replacementString ?? "",
                lineRange: edit.lineRange,
                beforeContext: edit.beforeContext,
                afterContext: edit.afterContext,
                fuzzyMode: edit.fuzzyMode,
                anchorSearchRange: edit.anchorSearchRange,
                indexRange: edit.indexRange,
                normalization: edit.normalization,
                normalizationConfig: edit.normalizationConfig,
                expectedHash: edit.expectedHash,
                contextFuzziness: edit.contextFuzziness,
                insertMode: edit.insertMode,
                insertLineRange: edit.insertLineRange,
                escapeMode: edit.escapeMode
            });
            editsByFile.set(filePath, fileEdits);
        }

        const fileVersions = this.normalizeFileVersions(args?.fileVersions);
        if (fileVersions.size > 0) {
            const mismatches = await this.findFileVersionMismatches(operationsByFile, fileVersions);
            if (mismatches.length > 0) {
                return this.buildFileVersionMismatchResponse(mismatches);
            }
        }

        const updatedFileStates: Record<string, { newVersion: number; newHash: string }> = {};

        for (const create of createOps) {
            const relPath = this.resolveRelativePath(create.filePath);
            const absPath = this.resolveAbsolutePath(relPath);
            if (!dryRun) {
                const dir = path.dirname(absPath);
                if (createMissingDirectories) {
                    await this.context.fileSystem.createDir(dir);
                }
                await this.context.fileSystem.writeFile(absPath, create.replacementString ?? "");
                this.context.indexStateManager?.markDirty(relPath);
                this.context.incrementalIndexer?.enqueuePaths(absPath, "high");
                const state = await this.getCurrentFileState(relPath, absPath, create.replacementString ?? "");
                if (state) {
                    updatedFileStates[relPath] = state;
                }
            }
            results.push({ filePath: relPath, applied: !dryRun, diff: undefined });
        }

        for (const del of deleteOps) {
            const relPath = this.resolveRelativePath(del.filePath);
            const absPath = this.resolveAbsolutePath(relPath);
            const stats = await this.context.fileSystem.stat(relPath).catch(() => undefined);
            const sizeBytes = stats?.size ?? 0;
            const confirmationHash = del.confirmationHash;
            const safetyLevel = del.safetyLevel ?? 'normal';

            if (sizeBytes > 10_000 && !confirmationHash && safetyLevel !== 'force') {
                results.push({
                    filePath: relPath,
                    applied: false,
                    requiresConfirmation: true,
                    error: 'Deletion requires confirmation for large files.',
                    fileSize: sizeBytes
                });
                continue;
            }

            if (confirmationHash) {
                const content = await this.context.fileSystem.readFile(relPath);
                const expected = typeof confirmationHash === 'string' ? confirmationHash : confirmationHash.value;
                const algo = typeof confirmationHash === 'string' ? 'sha256' : (confirmationHash.algorithm ?? 'sha256');
                const hash = this.computeHash(content, algo);
                if (hash !== expected) {
                    results.push({
                        filePath: relPath,
                        applied: false,
                        hashMismatch: true,
                        error: 'Hash mismatch detected; deletion blocked.',
                        fileSize: sizeBytes
                    });
                    continue;
                }
            }

            if (!dryRun) {
                await this.context.fileSystem.deleteFile(absPath);
                this.context.indexStateManager?.markDirty(relPath);
                void this.context.incrementalIndexer?.notifyDeletion(absPath);
            }
            results.push({ filePath: relPath, applied: !dryRun });
        }

        const fileEntries = Array.from(editsByFile.entries());
        if (fileEntries.length === 1) {
            const [filePath, fileEdits] = fileEntries[0];
            const result = await this.context.editCoordinator.applyEdits(
                this.resolveAbsolutePath(filePath),
                fileEdits,
                dryRun,
                diffMode ? { diffMode } : undefined
            );
            if (result.success) {
                if (!dryRun) {
                    this.context.indexStateManager?.markDirty(filePath);
                    this.context.incrementalIndexer?.enqueuePaths(this.resolveAbsolutePath(filePath), "high");
                    const absPath = this.resolveAbsolutePath(filePath);
                    const state = await this.getCurrentFileState(filePath, absPath);
                    if (state) {
                        updatedFileStates[filePath] = state;
                    }
                }
                results.push({
                    filePath,
                    applied: !dryRun,
                    diff: result.diff
                });
            } else {
                results.push({
                    filePath,
                    applied: false,
                    error: result.message ?? "Edit failed."
                });
            }
            return {
                success: result.success,
                results,
                message: result.message,
                updatedFileStates: Object.keys(updatedFileStates).length > 0 ? updatedFileStates : undefined
            };
        }

        if (fileEntries.length > 1) {
            const batch = fileEntries.map(([filePath, fileEdits]) => ({
                filePath: this.resolveAbsolutePath(filePath),
                edits: fileEdits
            }));
            const result = await this.context.editCoordinator.applyBatchEdits(batch, dryRun, diffMode ? { diffMode } : undefined);
            for (const [filePath] of fileEntries) {
                if (result.success && !dryRun) {
                    this.context.indexStateManager?.markDirty(filePath);
                    this.context.incrementalIndexer?.enqueuePaths(this.resolveAbsolutePath(filePath), "high");
                }
                results.push({ filePath, applied: result.success && !dryRun });
            }
            if (result.success && !dryRun) {
                const updated = await this.collectUpdatedFileStates(fileEntries.map(([filePath]) => filePath));
                Object.assign(updatedFileStates, updated);
            }
            return {
                success: result.success,
                results,
                message: result.message,
                updatedFileStates: Object.keys(updatedFileStates).length > 0 ? updatedFileStates : undefined
            };
        }

        return {
            success: results.length > 0,
            results,
            updatedFileStates: Object.keys(updatedFileStates).length > 0 ? updatedFileStates : undefined
        };
    }

    private async editFileRaw(args: any) {
        const filePath = this.resolveRelativePath(args.filePath);
        const absPath = this.resolveAbsolutePath(args.filePath);
        const edits = Array.isArray(args?.edits) ? args.edits : [];
        const mapped = edits.map((edit: any) => ({
            targetString: edit.targetString ?? "",
            replacementString: edit.replacementString ?? "",
            lineRange: edit.lineRange,
            beforeContext: edit.beforeContext,
            afterContext: edit.afterContext,
            fuzzyMode: edit.fuzzyMode,
            anchorSearchRange: edit.anchorSearchRange,
            indexRange: edit.indexRange,
            normalization: edit.normalization,
            normalizationConfig: edit.normalizationConfig,
            expectedHash: edit.expectedHash,
            contextFuzziness: edit.contextFuzziness,
            insertMode: edit.insertMode,
            insertLineRange: edit.insertLineRange,
            escapeMode: edit.escapeMode
        }));
        const result = await this.context.editCoordinator.applyEdits(
            absPath,
            mapped,
            Boolean(args?.dryRun)
        );
        if (result.success) {
            return result;
        }
        return {
            ...result,
            filePath,
            details: result.details
        };
    }

    private async executeGetBatchGuidance(args: any) {
        const filePaths = Array.isArray(args?.filePaths) ? args.filePaths : [];
        return {
            clusters: [],
            companionSuggestions: filePaths.map((filePath: string) => ({
                filePath,
                reason: "Review adjacent modules for cross-file edits."
            })),
            opportunities: []
        };
    }

    private async executeWriteFile(args: any) {
        const filePath = this.resolveRelativePath(args.filePath);
        const absPath = this.resolveAbsolutePath(args.filePath);
        const content = args?.content ?? "";
        await this.context.fileSystem.writeFile(absPath, content);
        this.context.fileVersionManager.incrementVersion(absPath, content);
        this.context.indexStateManager?.markDirty(filePath);
        this.context.incrementalIndexer?.enqueuePaths(absPath, "high");
        return { success: true, filePath };
    }

    private normalizeEditPayload(edit: any) {
        return {
            targetString: edit?.targetString ?? "",
            replacementString: edit?.replacementString ?? "",
            lineRange: edit?.lineRange,
            beforeContext: edit?.beforeContext,
            afterContext: edit?.afterContext,
            fuzzyMode: edit?.fuzzyMode,
            anchorSearchRange: edit?.anchorSearchRange,
            indexRange: edit?.indexRange,
            normalization: edit?.normalization,
            normalizationConfig: edit?.normalizationConfig,
            expectedHash: edit?.expectedHash,
            contextFuzziness: edit?.contextFuzziness,
            insertMode: edit?.insertMode,
            insertLineRange: edit?.insertLineRange,
            escapeMode: edit?.escapeMode
        };
    }

    private async executeEditCoordinator(args: any) {
        const edits = Array.isArray(args?.edits) ? args.edits : [];
        const dryRun = Boolean(args?.dryRun);
        const diffMode = args?.diffMode ?? args?.options?.diffMode;
        const skipImpactPreview = args?.options?.skipImpactPreview;
        const options = diffMode || skipImpactPreview !== undefined
            ? {
                diffMode,
                skipImpactPreview: skipImpactPreview === true
            }
            : undefined;

        const targetPath = args?.filePath ?? args?.path ?? args?.target;
        const fileVersions = this.normalizeFileVersions(args?.fileVersions);
        if (targetPath) {
            const relPath = this.resolveRelativePath(targetPath);
            const absPath = this.resolveAbsolutePath(targetPath);
            const normalized = edits.map((edit: any) => this.normalizeEditPayload(edit));
            const operationsByFile = new Map<string, Set<string>>();
            operationsByFile.set(relPath, new Set(edits.map((edit: any) => edit?.operation ?? 'replace')));
            if (fileVersions.size > 0) {
                const mismatches = await this.findFileVersionMismatches(operationsByFile, fileVersions);
                if (mismatches.length > 0) {
                    return this.buildFileVersionMismatchResponse(mismatches);
                }
            }
            const result = await this.context.editCoordinator.applyEdits(absPath, normalized, dryRun, options);
            if (!result) {
                return { success: false, message: "Edit failed." };
            }
            if (result.success && !dryRun) {
                const updated = await this.collectUpdatedFileStates([relPath]);
                return {
                    ...result,
                    updatedFileStates: Object.keys(updated).length > 0 ? updated : undefined
                };
            }
            return result;
        }

        const grouped = new Map<string, any[]>();
        const operationsByFile = new Map<string, Set<string>>();
        for (const edit of edits) {
            if (!edit?.filePath) continue;
            const relPath = this.resolveRelativePath(edit.filePath);
            const list = grouped.get(relPath) ?? [];
            list.push(this.normalizeEditPayload(edit));
            grouped.set(relPath, list);
            const operations = operationsByFile.get(relPath) ?? new Set<string>();
            operations.add(edit?.operation ?? 'replace');
            operationsByFile.set(relPath, operations);
        }

        if (grouped.size === 0) {
            return { success: false, message: "filePath is required for edit_transaction." };
        }

        if (fileVersions.size > 0) {
            const mismatches = await this.findFileVersionMismatches(operationsByFile, fileVersions);
            if (mismatches.length > 0) {
                return this.buildFileVersionMismatchResponse(mismatches);
            }
        }

        const batch = Array.from(grouped.entries()).map(([relPath, payload]) => ({
            filePath: this.resolveAbsolutePath(relPath),
            edits: payload
        }));
        const result = await this.context.editCoordinator.applyBatchEdits(batch, dryRun, options);
        if (!result) {
            return { success: false, message: "Edit failed." };
        }
        if (result.success && !dryRun) {
            const updated = await this.collectUpdatedFileStates(Array.from(grouped.keys()));
            return {
                ...result,
                updatedFileStates: Object.keys(updated).length > 0 ? updated : undefined
            };
        }
        return result;
    }

    private async executeImpactAnalyzer(args: any) {
        const targetPath = args?.target ?? args?.filePath ?? args?.path;
        if (!targetPath) {
            return { success: false, message: "target is required for impact analysis." };
        }
        const edits = Array.isArray(args?.edits) ? args.edits : [];
        const absPath = this.resolveAbsolutePath(targetPath);
        return this.context.impactAnalyzer.analyzeImpact(absPath, edits);
    }
}
