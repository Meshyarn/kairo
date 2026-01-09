import * as crypto from "crypto";
import type { Edit, EditOperation } from "../../types.js";

export function createOperationId(): string {
    return typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
}

export function buildEditOperation(filePath: string, edits: Edit[], inverseEdits: Edit[]): EditOperation {
    return {
        id: createOperationId(),
        timestamp: Date.now(),
        description: `Applied ${edits.length} edits to ${filePath}`,
        edits,
        inverseEdits
    };
}
