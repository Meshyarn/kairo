import type { HandlerContext } from "../HandlerContext.js";
import type { TransactionLogEntry } from "../../engine/TransactionLog.js";

export const summarizeCheckpoints = (entries: TransactionLogEntry[]): Array<{
    id: string;
    timestamp: string;
    status: string;
    description: string;
    diffSummary?: TransactionLogEntry["diffSummary"];
    filesTouched?: TransactionLogEntry["filesTouched"];
}> => entries.map(entry => ({
    id: entry.id,
    timestamp: new Date(entry.timestamp).toISOString(),
    status: entry.status,
    description: entry.description,
    diffSummary: entry.diffSummary,
    filesTouched: entry.filesTouched
}));

export const sanitizeHistoryStacks = (
    context: HandlerContext,
    history: { undoStack: any[]; redoStack: any[] },
    options: { includeExternal: boolean }
): { undoStack: any[]; redoStack: any[]; hiddenCount: number } => {
    const pathNormalizer = context.pathNormalizer;
    if (options.includeExternal || typeof pathNormalizer?.isWithinRoot !== "function") {
        return { undoStack: history.undoStack, redoStack: history.redoStack, hiddenCount: 0 };
    }
    const mask = (op: any): { op: any; hidden: number } => {
        if (typeof op?.filePath === "string" && !pathNormalizer.isWithinRoot(op.filePath)) {
            return { op: { ...op, filePath: "<external>" }, hidden: 1 };
        }
        return { op, hidden: 0 };
    };
    const sanitizeItem = (item: any): { item: any; hidden: number } => {
        if (Array.isArray(item?.operations)) {
            let hidden = 0;
            const operations = item.operations.map((op: any) => {
                const masked = mask(op);
                hidden += masked.hidden;
                return masked.op;
            });
            return { item: { ...item, operations }, hidden };
        }
        const masked = mask(item);
        return { item: masked.op, hidden: masked.hidden };
    };
    const sanitizeStack = (stack: any[]) => {
        let hiddenCount = 0;
        const items = stack.map((entry) => {
            const sanitized = sanitizeItem(entry);
            hiddenCount += sanitized.hidden;
            return sanitized.item;
        });
        return { items, hiddenCount };
    };
    const undo = sanitizeStack(Array.isArray(history.undoStack) ? history.undoStack : []);
    const redo = sanitizeStack(Array.isArray(history.redoStack) ? history.redoStack : []);
    return {
        undoStack: undo.items,
        redoStack: redo.items,
        hiddenCount: undo.hiddenCount + redo.hiddenCount
    };
};
