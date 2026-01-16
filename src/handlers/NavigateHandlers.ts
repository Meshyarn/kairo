import { BaseHandler } from "./BaseHandler.js";
import { HandlerContext } from "./HandlerContext.js";

export class NavigateHandlers extends BaseHandler {
    constructor(private context: HandlerContext) {
        super(context.toolSpecRegistry);
    }

    async handle(name: string, args: any): Promise<any> {
        const pillarTools = new Set(['navigate']);

        if (pillarTools.has(name)) {
            const missing = this.validateRequiredArgs(name, args);
            if (missing.length > 0) {
                return this.errorResponse("MissingParameter", `Missing required parameter(s): ${missing.join(', ')}`);
            }
            const result = await this.context.orchestrationEngine.executePillar('navigate', args);
            return this.jsonResponse(result);
        }

        return null;
    }
}
