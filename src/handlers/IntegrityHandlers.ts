import { BaseHandler } from "./BaseHandler.js";
import { HandlerContext } from "./HandlerContext.js";
import { IntegrityEngine } from "../integrity/IntegrityEngine.js";
import type { IntegrityScope, IntegritySourceType, IntegrityLimits, IntegrityMode } from "../integrity/IntegrityTypes.js";

export class IntegrityHandlers extends BaseHandler {
    constructor(private readonly context: HandlerContext) {
        super();
    }

    async handle(name: string, args: any): Promise<any> {
        const tools = new Set(['integrity_check', 'verify_constraints', 'detect_conflicts', 'auto_repair']);
        if (!tools.has(name)) return null;

        const query = args?.query ?? args?.target ?? args?.title ?? "";
        if (!String(query).trim()) {
            return this.errorResponse("MissingParameter", "Missing required parameter: query");
        }

        const runTool = (tool: string, toolArgs: any) => this.context.internalRegistry.execute(tool, toolArgs);
        const defaults = IntegrityEngine.resolveOptions(args?.integrity ?? true, "explore");
        const baseSources = Array.isArray(args?.sources)
            ? args.sources
            : (defaults?.sources ?? []);
        const extraSources = Array.isArray(args?.extraSources) ? args.extraSources : [];
        const request = {
            query,
            scope: (args?.scope ?? defaults?.scope ?? "docs") as IntegrityScope,
            sources: [...baseSources, ...extraSources] as IntegritySourceType[],
            limits: (args?.limits ?? defaults?.limits) as IntegrityLimits,
            mode: (args?.mode ?? defaults?.mode ?? "warn") as IntegrityMode,
            targetPaths: Array.isArray(args?.targetPaths) ? args.targetPaths : (args?.targets ?? [])
        };

        const result = await IntegrityEngine.run(request, runTool);

        if (name === 'detect_conflicts') {
            return this.jsonResponse({
                success: true,
                report: result.report,
                findings: result.report.topFindings ?? []
            });
        }

        if (name === 'auto_repair') {
            return this.jsonResponse({
                success: false,
                message: "auto_repair is not implemented yet.",
                report: result.report
            });
        }

        return this.jsonResponse({ success: true, report: result.report });
    }
}
