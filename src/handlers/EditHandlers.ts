import { BaseHandler } from "./BaseHandler.js";
import { HandlerContext } from "./HandlerContext.js";
import type { BatchOperation, FileOperation } from "../types.js";
import { AuditLog } from "../utils/AuditLog.js";
import {
    detectOverrideRequirementsForEditApply,
    evaluateOverride,
    type OverrideTrace
} from "../utils/GuardrailsOverride.js";
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
        super(context.toolSpecRegistry);
    }

    async handle(name: string, args: any): Promise<any> {
        const pillarTools = new Set(['change', 'write']);
        const internalTools = new Set(['edit_apply', 'file_edit', 'edit_transaction', 'edit_guidance', 'file_write']);

        if (pillarTools.has(name)) {
            const missing = this.validateRequiredArgs(name, args);
            if (missing.length > 0) {
                return this.errorResponse("MissingParameter", `Missing required parameter(s): ${missing.join(', ')}`);
            }
            const result = await this.context.orchestrationEngine.executePillar(name, args);
            return this.jsonResponse(result);
        }

        if (internalTools.has(name)) {
            const missing = this.validateRequiredArgs(name, args);
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
        const fileSystem = (this.context as any)?.fileSystem;
        if (fileSystem && typeof fileSystem.exists === "function") {
            return Boolean(await fileSystem.exists(relPath).catch(() => false));
        }
        if (fileSystem && typeof fileSystem.stat === "function") {
            try {
                await fileSystem.stat(relPath);
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

    private buildFileVersionMismatchResponse(
        mismatches: Array<{ filePath: string; current?: { version: number; contentHash: string } }>,
        operationsByFile?: Map<string, Set<string>>
    ) {
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
            status: "blocked",
            errorCode: "FILE_VERSION_MISMATCH",
            message: "File version mismatch detected. Re-read the file(s) and retry the edit.",
            results: mismatches.map((mismatch) => ({
                filePath: mismatch.filePath,
                operation: operationsByFile?.get(mismatch.filePath)?.values().next().value ?? "replace",
                applied: false,
                status: "blocked",
                error: "FILE_VERSION_MISMATCH",
                errorCode: "FILE_VERSION_MISMATCH",
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
        const rawOptions = args?.options && typeof args.options === "object" ? args.options : {};
        const applyMode = rawOptions.applyMode === "partial" ? "partial" : "atomic";
        const deleteMode = rawOptions.deleteMode === "confirm" ? "confirm" : "forbid";
        const ordering = rawOptions.ordering === "stable" ? "stable" : "creates_first";
        const overrideTargets = edits
            .map((edit: any) => (edit?.filePath ? this.resolveRelativePath(edit.filePath) : undefined))
            .filter(Boolean) as string[];
        const overrideDecision = evaluateOverride({
            override: args?.override,
            requiredOverrides: detectOverrideRequirementsForEditApply({ options: rawOptions, edits }),
            targetFiles: overrideTargets,
            pillar: "edit_apply"
        });
        let overrideTrace: OverrideTrace | undefined;
        if (overrideDecision) {
            const auditEventId = await AuditLog.append({
                pillar: "edit_apply",
                operation: "override_check",
                decision: overrideDecision.decision,
                actor: overrideDecision.approval?.approvedBy,
                reason: overrideDecision.approval?.reason,
                ticket: overrideDecision.approval?.ticket,
                scope: overrideDecision.scope,
                requested: overrideDecision.requestedAllow,
                effective: overrideDecision.effectiveAllow,
                targetFiles: overrideTargets,
                result: overrideDecision.errorCode
                    ? { success: false, status: "blocked", errorCode: overrideDecision.errorCode }
                    : undefined
            });
            overrideTrace = {
                auditEventId,
                decision: overrideDecision.decision,
                overridesUsed: overrideDecision.overridesUsed,
                expiresAt: overrideDecision.approval?.expiresAt
            };
            if (overrideDecision.errorCode) {
                return {
                    success: false,
                    status: "blocked",
                    errorCode: overrideDecision.errorCode,
                    blockedReason: overrideDecision.blockedReason,
                    message: overrideDecision.message,
                    overrideTrace,
                    results: [],
                    summary: { planned: 0, applied: 0, failed: 0, blocked: 1, confirmationRequired: 0 }
                };
            }
        }

        const operationsByFile = new Map<string, Set<string>>();
        const addOperation = (filePath: string, operation: string) => {
            const list = operationsByFile.get(filePath) ?? new Set<string>();
            list.add(operation);
            operationsByFile.set(filePath, list);
        };

        const createOps: Array<{ filePath: string; absPath: string; content: string }> = [];
        const deleteOps: Array<{ filePath: string; absPath: string; confirmationHash?: any }> = [];
        const replaceEditsByFile = new Map<string, any[]>();
        const stableOps: Array<{ operation: "create" | "replace" | "delete"; filePath: string; absPath: string; edits?: any[]; content?: string; confirmationHash?: any }> = [];

        for (const edit of edits) {
            if (!edit?.filePath) continue;
            const operation = edit.operation ?? "replace";
            const filePath = this.resolveRelativePath(edit.filePath);
            const absPath = this.resolveAbsolutePath(filePath);
            addOperation(filePath, operation);
            if (operation === "create") {
                const content = edit.replacementString ?? "";
                createOps.push({ filePath, absPath, content });
                stableOps.push({ operation: "create", filePath, absPath, content });
                continue;
            }
            if (operation === "delete") {
                deleteOps.push({ filePath, absPath, confirmationHash: edit.confirmationHash });
                stableOps.push({ operation: "delete", filePath, absPath, confirmationHash: edit.confirmationHash });
                continue;
            }
            const fileEdits = replaceEditsByFile.get(filePath) ?? [];
            fileEdits.push(this.normalizeEditPayload(edit));
            replaceEditsByFile.set(filePath, fileEdits);
            stableOps.push({ operation: "replace", filePath, absPath, edits: [this.normalizeEditPayload(edit)] });
        }

        const fileVersions = this.normalizeFileVersions(args?.fileVersions);
        if (fileVersions.size > 0) {
            const mismatches = await this.findFileVersionMismatches(operationsByFile, fileVersions);
            if (mismatches.length > 0) {
                return this.buildFileVersionMismatchResponse(mismatches, operationsByFile);
            }
        }

        const preflightResults: any[] = [];
        const preflightMap = new Map<string, any>();
        const recordPreflight = (entry: any) => {
            preflightResults.push(entry);
            preflightMap.set(`${entry.filePath}::${entry.operation}`, entry);
        };
        const ensureDirExists = async (dirPath: string) => {
            const exists = await this.readExists(dirPath);
            if (exists) return true;
            return createMissingDirectories;
        };

        for (const create of createOps) {
            const exists = await this.readExists(create.filePath);
            if (exists) {
                recordPreflight({
                    filePath: create.filePath,
                    operation: "create",
                    applied: false,
                    status: "failed",
                    errorCode: "CREATE_ALREADY_EXISTS",
                    message: "File already exists.",
                    error: "File already exists."
                });
                continue;
            }
            const dirPath = path.dirname(create.absPath);
            const dirOk = await ensureDirExists(dirPath);
            if (!dirOk) {
                recordPreflight({
                    filePath: create.filePath,
                    operation: "create",
                    applied: false,
                    status: "failed",
                    errorCode: "MISSING_PARENT_DIR",
                    message: "Parent directory is missing.",
                    error: "Parent directory is missing."
                });
                continue;
            }
            recordPreflight({
                filePath: create.filePath,
                operation: "create",
                applied: false,
                status: "dry_run_ok"
            });
        }

        for (const del of deleteOps) {
            if (deleteMode === "forbid") {
                recordPreflight({
                    filePath: del.filePath,
                    operation: "delete",
                    applied: false,
                    status: "blocked",
                    errorCode: "DELETE_FORBIDDEN",
                    message: "Delete is blocked by policy.",
                    error: "Delete is blocked by policy."
                });
                continue;
            }
            const exists = await this.readExists(del.filePath);
            if (!exists) {
                recordPreflight({
                    filePath: del.filePath,
                    operation: "delete",
                    applied: false,
                    status: "failed",
                    errorCode: "MISSING_FILE",
                    message: "File does not exist.",
                    error: "File does not exist."
                });
                continue;
            }
            if (!del.confirmationHash) {
                recordPreflight({
                    filePath: del.filePath,
                    operation: "delete",
                    applied: false,
                    status: "confirmation_required",
                    requiresConfirmation: true,
                    errorCode: "DELETE_CONFIRMATION_REQUIRED",
                    message: "Delete requires confirmation hash.",
                    error: "Delete requires confirmation hash.",
                    confirmationHint: {
                        algorithm: "sha256",
                        valueFormat: "hex",
                        rationale: "Provide a hash of the current file content to confirm deletion."
                    }
                });
                continue;
            }
            let content = "";
            try {
                content = await this.context.fileSystem.readFile(del.filePath);
            } catch (error: any) {
                recordPreflight({
                    filePath: del.filePath,
                    operation: "delete",
                    applied: false,
                    status: "failed",
                    errorCode: "MISSING_FILE",
                    message: error?.message ?? "File does not exist.",
                    error: error?.message ?? "File does not exist."
                });
                continue;
            }
            const expected = typeof del.confirmationHash === "string" ? del.confirmationHash : del.confirmationHash.value;
            const algo = typeof del.confirmationHash === "string" ? "sha256" : (del.confirmationHash.algorithm ?? "sha256");
            const hash = this.computeHash(content, algo);
            if (hash !== expected) {
                recordPreflight({
                    filePath: del.filePath,
                    operation: "delete",
                    applied: false,
                    status: "failed",
                    errorCode: "DELETE_HASH_MISMATCH",
                    message: "Hash mismatch detected; deletion blocked.",
                    error: "Hash mismatch detected; deletion blocked."
                });
                continue;
            }
            recordPreflight({
                filePath: del.filePath,
                operation: "delete",
                applied: false,
                status: "dry_run_ok"
            });
        }

        for (const [filePath, fileEdits] of replaceEditsByFile.entries()) {
            const exists = await this.readExists(filePath);
            if (!exists) {
                recordPreflight({
                    filePath,
                    operation: "replace",
                    applied: false,
                    status: "failed",
                    errorCode: "MISSING_FILE",
                    message: "File does not exist.",
                    error: "File does not exist."
                });
                continue;
            }
            const absPath = this.resolveAbsolutePath(filePath);
            let previewResult: any;
            try {
                previewResult = await this.context.editCoordinator.applyEdits(
                    absPath,
                    fileEdits,
                    true,
                    diffMode ? { diffMode } : undefined
                );
            } catch (error: any) {
                recordPreflight({
                    filePath,
                    operation: "replace",
                    applied: false,
                    status: "failed",
                    errorCode: "BATCH_APPLY_FAILED",
                    message: error?.message ?? "Edit failed.",
                    error: error?.message ?? "Edit failed."
                });
                continue;
            }
            if (!previewResult?.success) {
                recordPreflight({
                    filePath,
                    operation: "replace",
                    applied: false,
                    status: "failed",
                    errorCode: previewResult?.errorCode ?? "BATCH_APPLY_FAILED",
                    message: previewResult?.message ?? "Edit failed.",
                    error: previewResult?.message ?? "Edit failed."
                });
                continue;
            }
            recordPreflight({
                filePath,
                operation: "replace",
                applied: false,
                status: "dry_run_ok",
                diff: previewResult?.diff
            });
        }

        const summarize = (entries: any[]) => {
            const summary = { planned: entries.length, applied: 0, failed: 0, blocked: 0, confirmationRequired: 0 };
            for (const entry of entries) {
                switch (entry.status) {
                    case "applied":
                        summary.applied += 1;
                        break;
                    case "blocked":
                        summary.blocked += 1;
                        break;
                    case "confirmation_required":
                        summary.confirmationRequired += 1;
                        break;
                    case "failed":
                        summary.failed += 1;
                        break;
                    default:
                        break;
                }
            }
            return summary;
        };

        const anyStatus = (entries: any[], status: string) => entries.some((entry) => entry.status === status);
        const hasPreflightFailures = anyStatus(preflightResults, "failed") || anyStatus(preflightResults, "blocked") || anyStatus(preflightResults, "confirmation_required");
        if (dryRun || (applyMode === "atomic" && hasPreflightFailures)) {
            const summary = summarize(preflightResults);
            const blocked = anyStatus(preflightResults, "blocked") || anyStatus(preflightResults, "confirmation_required");
            const failed = anyStatus(preflightResults, "failed");
            const response = {
                success: !blocked && !failed,
                status: blocked ? "blocked" : (failed ? "failed" : "success"),
                message: blocked ? "Preflight blocked the apply request." : (failed ? "Preflight failed for one or more edits." : "Dry run completed."),
                results: preflightResults,
                summary
            };
            if (overrideTrace) {
                (response as any).overrideTrace = overrideTrace;
            }
            if (overrideDecision) {
                void AuditLog.append({
                    pillar: "edit_apply",
                    operation: dryRun ? "dry_run" : "apply",
                    decision: overrideDecision.decision,
                    actor: overrideDecision.approval?.approvedBy,
                    reason: overrideDecision.approval?.reason,
                    ticket: overrideDecision.approval?.ticket,
                    scope: overrideDecision.scope,
                    requested: overrideDecision.requestedAllow,
                    effective: overrideDecision.effectiveAllow,
                    targetFiles: overrideTargets,
                    result: {
                        success: response.success,
                        status: response.status,
                        errorCode: (response as any).errorCode
                    }
                });
            }
            return response;
        }

        if (applyMode === "atomic" && createOps.length === 0 && deleteOps.length === 0 && replaceEditsByFile.size > 1) {
            const orderedReplaceFiles = ordering === "stable"
                ? Array.from(new Set(stableOps.filter((op) => op.operation === "replace").map((op) => op.filePath)))
                : Array.from(replaceEditsByFile.keys());
            const batch = orderedReplaceFiles.map((filePath) => ({
                filePath: this.resolveAbsolutePath(filePath),
                edits: replaceEditsByFile.get(filePath) ?? []
            }));
            const batchResult = await this.context.editCoordinator.applyBatchEdits(
                batch,
                false,
                diffMode ? { diffMode } : undefined
            );
            if (!batchResult?.success) {
                const errorMessage = batchResult?.message ?? "Batch apply failed.";
                const errorCode = batchResult?.errorCode ?? "BATCH_APPLY_FAILED";
                const failedResults = orderedReplaceFiles.map((filePath) => ({
                    filePath,
                    operation: "replace",
                    applied: false,
                    status: "failed",
                    errorCode,
                    message: errorMessage,
                    error: errorMessage
                }));
                const response = {
                    success: false,
                    status: "failed",
                    message: errorMessage,
                    errorCode,
                    results: failedResults,
                    summary: summarize(failedResults)
                };
                if (overrideTrace) {
                    (response as any).overrideTrace = overrideTrace;
                }
                if (overrideDecision) {
                    void AuditLog.append({
                        pillar: "edit_apply",
                        operation: "apply",
                        decision: overrideDecision.decision,
                        actor: overrideDecision.approval?.approvedBy,
                        reason: overrideDecision.approval?.reason,
                        ticket: overrideDecision.approval?.ticket,
                        scope: overrideDecision.scope,
                        requested: overrideDecision.requestedAllow,
                        effective: overrideDecision.effectiveAllow,
                        targetFiles: overrideTargets,
                        result: {
                            success: false,
                            status: "failed",
                            errorCode
                        }
                    });
                }
                return response;
            }
            const results = orderedReplaceFiles.map((filePath) => {
                const preflight = preflightMap.get(`${filePath}::replace`);
                return {
                    filePath,
                    operation: "replace",
                    applied: true,
                    status: "applied",
                    diff: preflight?.diff
                };
            });
            for (const filePath of orderedReplaceFiles) {
                const absPath = this.resolveAbsolutePath(filePath);
                this.context.indexStateManager?.markDirty(filePath);
                this.context.incrementalIndexer?.enqueuePaths(absPath, "high");
                this.context.cacheInvalidationHub?.onEvent({ type: "file_changed", absPath });
            }
            const updated = await this.collectUpdatedFileStates(orderedReplaceFiles);
            const response = {
                success: true,
                status: "success",
                results,
                summary: summarize(results),
                updatedFileStates: Object.keys(updated).length > 0 ? updated : undefined
            };
            if (overrideTrace) {
                (response as any).overrideTrace = overrideTrace;
            }
            if (overrideDecision) {
                void AuditLog.append({
                    pillar: "edit_apply",
                    operation: "apply",
                    decision: overrideDecision.decision,
                    actor: overrideDecision.approval?.approvedBy,
                    reason: overrideDecision.approval?.reason,
                    ticket: overrideDecision.approval?.ticket,
                    scope: overrideDecision.scope,
                    requested: overrideDecision.requestedAllow,
                    effective: overrideDecision.effectiveAllow,
                    targetFiles: overrideTargets,
                    result: {
                        success: true,
                        status: "success"
                    }
                });
            }
            return response;
        }

        const updatedFileStates: Record<string, { newVersion: number; newHash: string }> = {};
        const appliedFiles = new Set<string>();
        const appliedDeletes = new Set<string>();
        const results: any[] = [];
        const postApplyActions: Array<{ type: "write" | "delete"; filePath: string; absPath: string }> = [];
        const fileOperations: FileOperation[] = [];
        const recordFileOperation = (action: "create" | "delete", filePath: string, content?: string) => {
            fileOperations.push({
                type: "file",
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                description: "edit_apply file operation",
                filePath,
                action,
                content
            });
        };

        const snapshot = new Map<string, { exists: boolean; content?: string }>();
        if (applyMode === "atomic") {
            const affected = new Set<string>();
            for (const op of [...createOps, ...deleteOps]) {
                affected.add(op.filePath);
            }
            for (const filePath of replaceEditsByFile.keys()) {
                affected.add(filePath);
            }
            for (const filePath of affected) {
                const absPath = this.resolveAbsolutePath(filePath);
                const exists = await this.readExists(filePath);
                if (exists) {
                    try {
                        const content = await this.context.fileSystem.readFile(filePath);
                        snapshot.set(filePath, { exists: true, content });
                    } catch {
                        snapshot.set(filePath, { exists: true, content: "" });
                    }
                } else {
                    snapshot.set(filePath, { exists: false });
                }
            }
        }

        const applyCreate = async (create: { filePath: string; absPath: string; content?: string }) => {
            if (createMissingDirectories) {
                const dir = path.dirname(create.absPath);
                await this.context.fileSystem.createDir(dir);
            }
            await this.context.fileSystem.writeFile(create.absPath, create.content ?? "");
            appliedFiles.add(create.filePath);
            results.push({ filePath: create.filePath, operation: "create", applied: true, status: "applied" });
            postApplyActions.push({ type: "write", filePath: create.filePath, absPath: create.absPath });
            recordFileOperation("create", create.filePath, create.content ?? "");
        };

        const applyReplace = async (filePath: string, editsForFile: any[]) => {
            const absPath = this.resolveAbsolutePath(filePath);
            const result = await this.context.editCoordinator.applyEdits(
                absPath,
                editsForFile,
                false,
                diffMode ? { diffMode } : undefined
            );
            if (!result?.success) {
                results.push({
                    filePath,
                    operation: "replace",
                    applied: false,
                    status: "failed",
                    errorCode: result?.errorCode ?? "BATCH_APPLY_FAILED",
                    message: result?.message ?? "Edit failed.",
                    error: result?.message ?? "Edit failed."
                });
                return false;
            }
            appliedFiles.add(filePath);
            results.push({
                filePath,
                operation: "replace",
                applied: true,
                status: "applied",
                diff: result?.diff
            });
            postApplyActions.push({ type: "write", filePath, absPath });
            return true;
        };

        const applyDelete = async (del: { filePath: string; absPath: string }) => {
            const content = await this.context.fileSystem.readFile(del.absPath);
            await this.context.fileSystem.deleteFile(del.absPath);
            appliedDeletes.add(del.filePath);
            results.push({ filePath: del.filePath, operation: "delete", applied: true, status: "applied" });
            postApplyActions.push({ type: "delete", filePath: del.filePath, absPath: del.absPath });
            recordFileOperation("delete", del.filePath, content);
        };

        const rollback = async () => {
            for (const [filePath, state] of snapshot.entries()) {
                const absPath = this.resolveAbsolutePath(filePath);
                if (state.exists) {
                    const dir = path.dirname(absPath);
                    await this.context.fileSystem.createDir(dir);
                    await this.context.fileSystem.writeFile(absPath, state.content ?? "");
                } else if (await this.readExists(filePath)) {
                    await this.context.fileSystem.deleteFile(absPath);
                }
            }
        };

        const ordered = ordering === "stable"
            ? stableOps
            : [
                ...createOps.map((op) => ({ operation: "create" as const, filePath: op.filePath, absPath: op.absPath, content: op.content })),
                ...Array.from(replaceEditsByFile.entries()).map(([filePath, editsForFile]) => ({
                    operation: "replace" as const,
                    filePath,
                    absPath: this.resolveAbsolutePath(filePath),
                    edits: editsForFile
                })),
                ...deleteOps.map((op) => ({ operation: "delete" as const, filePath: op.filePath, absPath: op.absPath, confirmationHash: op.confirmationHash }))
            ];

        let applyFailed = false;
        const attemptedKeys = new Set<string>();
        for (const op of ordered) {
            const opKey = `${op.filePath}::${op.operation}`;
            attemptedKeys.add(opKey);
            if (applyMode === "partial") {
                const preflight = preflightMap.get(opKey);
                if (!preflight || preflight.status !== "dry_run_ok") {
                    results.push({
                        ...(preflight ?? {
                            filePath: op.filePath,
                            operation: op.operation,
                            applied: false,
                            status: "blocked",
                            message: "Preflight blocked this operation."
                        })
                    });
                    continue;
                }
            }
            if (op.operation === "create") {
                try {
                    await applyCreate(op);
                } catch (error: any) {
                    results.push({
                        filePath: op.filePath,
                        operation: "create",
                        applied: false,
                        status: "failed",
                        errorCode: "BATCH_APPLY_FAILED",
                        message: error?.message ?? "Create failed.",
                        error: error?.message ?? "Create failed."
                    });
                    applyFailed = true;
                }
            } else if (op.operation === "replace") {
                const success = await applyReplace(op.filePath, op.edits ?? []);
                if (!success) applyFailed = true;
            } else if (op.operation === "delete") {
                try {
                    await applyDelete(op);
                } catch (error: any) {
                    results.push({
                        filePath: op.filePath,
                        operation: "delete",
                        applied: false,
                        status: "failed",
                        errorCode: "BATCH_APPLY_FAILED",
                        message: error?.message ?? "Delete failed.",
                        error: error?.message ?? "Delete failed."
                    });
                    applyFailed = true;
                }
            }
            if (applyFailed && applyMode === "atomic") {
                break;
            }
        }

        if (applyFailed && applyMode === "atomic") {
            await rollback();
            for (const [key, entry] of preflightMap.entries()) {
                if (!attemptedKeys.has(key)) {
                    results.push({
                        ...entry,
                        applied: false,
                        status: "blocked",
                        errorCode: entry.errorCode ?? "BATCH_APPLY_FAILED",
                        message: entry.message ?? "Blocked due to atomic failure.",
                        error: entry.message ?? "Blocked due to atomic failure."
                    });
                }
            }
            const failedResults = results.map((entry) => ({
                ...entry,
                applied: false,
                status: entry.status === "failed" ? "failed" : "blocked",
                errorCode: entry.errorCode ?? "BATCH_APPLY_FAILED",
                message: entry.message ?? "Rolled back due to atomic failure.",
                error: entry.message ?? "Rolled back due to atomic failure."
            }));
            return {
                success: false,
                status: "failed",
                message: "Atomic apply failed; all changes rolled back.",
                errorCode: "BATCH_APPLY_FAILED",
                results: failedResults,
                summary: summarize(failedResults),
                ...(overrideTrace ? { overrideTrace } : {})
            };
        }

        if (applyMode === "atomic") {
            for (const action of postApplyActions) {
                if (action.type === "write") {
                    this.context.indexStateManager?.markDirty(action.filePath);
                    this.context.incrementalIndexer?.enqueuePaths(action.absPath, "high");
                    this.context.cacheInvalidationHub?.onEvent({ type: "file_changed", absPath: action.absPath });
                } else {
                    this.context.indexStateManager?.markDirty(action.filePath);
                    void this.context.incrementalIndexer?.notifyDeletion(action.absPath);
                    this.context.cacheInvalidationHub?.onEvent({ type: "file_deleted", absPath: action.absPath });
                }
            }
        } else {
            for (const action of postApplyActions) {
                if (action.type === "write") {
                    this.context.indexStateManager?.markDirty(action.filePath);
                    this.context.incrementalIndexer?.enqueuePaths(action.absPath, "high");
                    this.context.cacheInvalidationHub?.onEvent({ type: "file_changed", absPath: action.absPath });
                } else {
                    this.context.indexStateManager?.markDirty(action.filePath);
                    void this.context.incrementalIndexer?.notifyDeletion(action.absPath);
                    this.context.cacheInvalidationHub?.onEvent({ type: "file_deleted", absPath: action.absPath });
                }
            }
        }

        const appliedPaths = Array.from(appliedFiles.values());
        const updated = await this.collectUpdatedFileStates(appliedPaths);
        Object.assign(updatedFileStates, updated);

        if (fileOperations.length > 0) {
            const batchOperation: BatchOperation = {
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                description: "edit_apply file operations",
                operations: fileOperations
            };
            await this.context.historyEngine.pushOperation(batchOperation);
        }

        const summary = summarize(results);
        const success = applyMode === "partial"
            ? results.every((entry) => entry.status === "applied")
            : !applyFailed;
        const status = success
            ? "success"
            : (summary.applied > 0 ? "partial_success" : (summary.blocked > 0 || summary.confirmationRequired > 0 ? "blocked" : "failed"));

        const response = {
            success,
            status,
            results,
            summary,
            updatedFileStates: Object.keys(updatedFileStates).length > 0 ? updatedFileStates : undefined
        };
        if (overrideTrace) {
            (response as any).overrideTrace = overrideTrace;
        }
        if (overrideDecision) {
            void AuditLog.append({
                pillar: "edit_apply",
                operation: dryRun ? "dry_run" : "apply",
                decision: overrideDecision.decision,
                actor: overrideDecision.approval?.approvedBy,
                reason: overrideDecision.approval?.reason,
                ticket: overrideDecision.approval?.ticket,
                scope: overrideDecision.scope,
                requested: overrideDecision.requestedAllow,
                effective: overrideDecision.effectiveAllow,
                targetFiles: overrideTargets,
                result: {
                    success,
                    status,
                    errorCode: (response as any).errorCode
                }
            });
        }
        return response;
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
        this.context.cacheInvalidationHub?.onEvent({ type: "file_changed", absPath });
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
                    return this.buildFileVersionMismatchResponse(mismatches, operationsByFile);
                }
            }
            const result = await this.context.editCoordinator.applyEdits(absPath, normalized, dryRun, options);
            if (!result) {
                return { success: false, message: "Edit failed." };
            }
            if (result.success && !dryRun) {
                const updated = await this.collectUpdatedFileStates([relPath]);
                this.context.cacheInvalidationHub?.onEvent({ type: "file_changed", absPath });
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
                return this.buildFileVersionMismatchResponse(mismatches, operationsByFile);
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
            for (const relPath of grouped.keys()) {
                const absPath = this.resolveAbsolutePath(relPath);
                this.context.cacheInvalidationHub?.onEvent({ type: "file_changed", absPath });
            }
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
