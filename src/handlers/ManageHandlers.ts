import { BaseHandler } from "./BaseHandler.js";
import { HandlerContext } from "./HandlerContext.js";
import { manageProjectRaw } from "./manage/ManageProjectOps.js";
import { createManageHandlerDeps, type ManageHandlerDeps, type ManageReindexState } from "./manage/ManageHandlerUtils.js";

export class ManageHandlers extends BaseHandler {
    private readonly schemaArtifactTtlMs = 30 * 60 * 1000;
    private readonly reindexState: ManageReindexState = { inProgress: false };
    private readonly deps: ManageHandlerDeps;

    constructor(private context: HandlerContext) {
        super(context.toolSpecRegistry);
        this.deps = createManageHandlerDeps(context, this.reindexState, this.schemaArtifactTtlMs);
    }

    public async manageProjectRaw(args: any): Promise<any> {
        return manageProjectRaw(this.deps, args);
    }

    async handle(name: string, args: any): Promise<any> {
        const pillarTools = new Set(['manage']);
        const internalTools = new Set(['project_manage']);

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
            return this.jsonResponse(await this.manageProjectRaw(args));
        }
        return null;
    }
}
