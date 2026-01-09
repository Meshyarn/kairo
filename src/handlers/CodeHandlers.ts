import { BaseHandler } from "./BaseHandler.js";
import { HandlerContext } from "./HandlerContext.js";
import { analyzeRelationshipRaw } from "./code/CodeAnalysisOps.js";
import { readCodeRaw, readFileProfileRaw, readFileRaw, readFragmentRaw } from "./code/CodeReadOps.js";
import { executeAnalyzeFile, executeReconstructInterface, findReferencesRaw, listFilesRaw, projectStatsRaw, statFileRaw } from "./code/CodeProjectOps.js";
import { createCodeHandlerDeps, type CodeHandlerDeps } from "./code/CodeHandlerUtils.js";

export class CodeHandlers extends BaseHandler {
    private readonly deps: CodeHandlerDeps;

    constructor(private context: HandlerContext) {
        super();
        this.deps = createCodeHandlerDeps(context);
    }

    async handle(name: string, args: any): Promise<any> {
        const pillarTools = new Set(['understand']);
        const internalTools = new Set(['code_read', 'file_read', 'file_fragment_read', 'relationship_analyze', 'interface_reconstruct', 'file_analyze', 'file_list', 'file_stat', 'reference_find']);

        if (pillarTools.has(name)) {
            const missing = this.validateRequiredArgs(name, args, { understand: ['goal'] });
            if (missing.length > 0) {
                return this.errorResponse("MissingParameter", `Missing required parameter(s): ${missing.join(', ')}`);
            }
            const result = await this.context.orchestrationEngine.executePillar(name, args);
            return this.jsonResponse(result);
        }

        if (internalTools.has(name)) {
            const requiredMap: Record<string, string[]> = {
                code_read: ['filePath'],
                file_read: ['filePath'],
                file_fragment_read: ['filePath'],
                relationship_analyze: ['target', 'mode'],
                interface_reconstruct: ['symbolName'],
                file_analyze: ['filePath'],
                file_list: [],
                file_stat: ['path'],
                reference_find: ['symbolName']
            };
            const missing = this.validateRequiredArgs(name, args, requiredMap);
            if (missing.length > 0) {
                return this.errorResponse("MissingParameter", `Missing required parameter(s): ${missing.join(', ')}`);
            }

            switch (name) {
                case 'code_read':
                    return this.textResponse(await this.readCodeRaw(args));
                case 'file_read':
                    return this.jsonResponse(await this.readFileRaw(args));
                case 'file_fragment_read':
                    return this.jsonResponse(await this.readFragmentRaw(args));
                case 'relationship_analyze':
                    return this.jsonResponse(await this.analyzeRelationshipRaw(args));
                case 'interface_reconstruct':
                    return this.jsonResponse(await this.executeReconstructInterface(args));
                case 'file_analyze':
                    return this.jsonResponse(await this.executeAnalyzeFile(args));
                case 'file_list':
                    return this.jsonResponse(await this.listFilesRaw(args));
                case 'file_stat':
                    return this.jsonResponse(await this.statFileRaw(args));
                case 'reference_find':
                    return this.jsonResponse(await this.findReferencesRaw(args));
                default:
                    break;
            }
        }
        return null;
    }

    private async readCodeRaw(args: any): Promise<string> {
        return readCodeRaw(this.deps, args);
    }

    private async readFileRaw(args: any) {
        return readFileRaw(this.deps, args);
    }

    private async readFragmentRaw(args: any) {
        return readFragmentRaw(this.deps, args);
    }

    private async readFileProfileRaw(args: any) {
        return readFileProfileRaw(this.deps, args);
    }

    private async analyzeRelationshipRaw(args: any) {
        return analyzeRelationshipRaw(this.deps, args);
    }

    private async executeReconstructInterface(args: any) {
        return executeReconstructInterface(this.deps, args);
    }

    private async executeAnalyzeFile(args: any) {
        return executeAnalyzeFile(this.deps, args);
    }

    private async listFilesRaw(args: any) {
        return listFilesRaw(this.deps, args);
    }

    private async statFileRaw(args: any) {
        return statFileRaw(this.deps, args);
    }

    private async findReferencesRaw(args: any) {
        return findReferencesRaw(this.deps, args);
    }

    private async projectStatsRaw() {
        return projectStatsRaw(this.deps);
    }
}
