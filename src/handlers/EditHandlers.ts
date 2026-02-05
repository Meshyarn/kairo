import { BaseHandler } from "./BaseHandler.js";
import { HandlerContext } from "./HandlerContext.js";
import { editCodeRaw } from "./edit/EditApplyFlow.js";
import { editFileRaw, executeWriteFile } from "./edit/EditFileFlow.js";
import { executeGetBatchGuidance } from "./edit/EditGuidanceFlow.js";
import { executeEditCoordinator } from "./edit/EditCoordinatorFlow.js";
import { executeImpactAnalyzer } from "./edit/EditImpactFlow.js";
import { computeHash } from "./edit/EditHashUtils.js";
import { normalizeEditPayload } from "./edit/EditPayloadUtils.js";
import {
    readExists,
    normalizeFileVersions,
    collectUpdatedFileStates,
    findFileVersionMismatches,
    buildFileVersionMismatchResponse
} from "./edit/EditFileVersions.js";

export class EditHandlers extends BaseHandler {
    constructor(private context: HandlerContext) {
        super(context.toolSpecRegistry);
    }

    public async editCodeRaw(args: any): Promise<any> {
        return editCodeRaw(args, this.buildEditDeps());
    }

    public async editFileRaw(args: any): Promise<any> {
        return editFileRaw(args, this.buildEditDeps());
    }

    public async executeEditCoordinator(args: any): Promise<any> {
        return executeEditCoordinator(args, this.buildEditDeps());
    }

    public async executeWriteFile(args: any): Promise<any> {
        return executeWriteFile(args, this.buildEditDeps());
    }

    public async executeImpactAnalyzer(args: any): Promise<any> {
        return executeImpactAnalyzer(args, this.context);
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
                    return this.jsonResponse(await executeGetBatchGuidance(args));
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

    private buildEditDeps() {
        const resolveRelativePath = (inputPath: string) => this.resolveRelativePath(inputPath);
        const resolveAbsolutePath = (inputPath: string) => this.resolveAbsolutePath(inputPath);
        const readExistsFn = (relPath: string) => readExists(this.context, relPath);
        const normalizeFileVersionsFn = (raw: any) => normalizeFileVersions(resolveRelativePath, raw);
        const findFileVersionMismatchesFn = (operationsByFile: Map<string, Set<string>>, fileVersions: Map<string, { expectedVersion?: number; expectedHash?: string }>) =>
            findFileVersionMismatches(this.context, resolveAbsolutePath, operationsByFile, fileVersions);
        const collectUpdatedFileStatesFn = (paths: string[]) =>
            collectUpdatedFileStates(this.context, resolveAbsolutePath, paths, readExists);
        return {
            context: this.context,
            resolveRelativePath,
            resolveAbsolutePath,
            computeHash,
            normalizeEditPayload,
            readExists: readExistsFn,
            normalizeFileVersions: normalizeFileVersionsFn,
            findFileVersionMismatches: findFileVersionMismatchesFn,
            buildFileVersionMismatchResponse,
            collectUpdatedFileStates: collectUpdatedFileStatesFn
        };
    }


}
