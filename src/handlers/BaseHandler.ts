import type { ToolSpecRegistry } from "../server/tools/ToolSpecRegistry.js";

export abstract class BaseHandler {
    protected readonly toolSpecRegistry?: ToolSpecRegistry;

    constructor(toolSpecRegistry?: ToolSpecRegistry) {
        this.toolSpecRegistry = toolSpecRegistry;
    }

    protected jsonResponse(payload: any): any {
        return {
            isError: false,
            content: [{ type: 'text', text: JSON.stringify(payload, this.jsonReplacer, 2) }]
        };
    }

    protected jsonReplacer(_key: string, value: any): any {
        if (value instanceof Map) {
            return Object.fromEntries(value.entries());
        }
        if (value instanceof Set) {
            return Array.from(value.values());
        }
        return value;
    }

    protected textResponse(text: string): any {
        return {
            isError: false,
            content: [{ type: 'text', text }]
        };
    }

    protected errorResponse(errorCode: string, message: string, details?: any): any {
        return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({ errorCode, message, details }) }]
        };
    }

    protected validateRequiredArgs(toolName: string, args: any): string[] {
        const required = Array.isArray(this.toolSpecRegistry?.get(toolName)?.inputSchema?.required)
            ? this.toolSpecRegistry?.get(toolName)?.inputSchema?.required ?? []
            : [];
        const missing: string[] = [];
        for (const key of required) {
            if (args?.[key] === undefined || args?.[key] === null) {
                missing.push(key);
            }
        }
        return missing;
    }
}
