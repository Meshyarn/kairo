import { validateRequiredArgs } from "./shared/ValidationHelpers.js";

export abstract class BaseHandler {
    protected jsonResponse(payload: any): any {
        return { content: [{ type: 'text', text: JSON.stringify(payload, this.jsonReplacer, 2) }] };
    }

    protected jsonReplacer(_key: string, value: any): any {
        if (value instanceof Map) {
            return { __type: "Map", entries: Array.from(value.entries()) };
        }
        if (value instanceof Set) {
            return { __type: "Set", values: Array.from(value.values()) };
        }
        return value;
    }

    protected textResponse(text: string): any {
        return { content: [{ type: 'text', text }] };
    }

    protected errorResponse(errorCode: string, message: string, details?: any): any {
        return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({ errorCode, message, details }) }]
        };
    }

    protected validateRequiredArgs(toolName: string, args: any, requiredMap: Record<string, string[]>): string[] {
        const required = requiredMap[toolName] || [];
        return validateRequiredArgs(args, required);
    }
}
