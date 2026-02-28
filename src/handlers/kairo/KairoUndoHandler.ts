import { BaseHandler } from "../BaseHandler.js";
import type { HandlerContext } from "../HandlerContext.js";

export class KairoUndoHandler extends BaseHandler {
  private context: HandlerContext;

  constructor(context: HandlerContext) {
    super(context.toolSpecRegistry);
    this.context = context;
  }

  async handle(name: string, args: any): Promise<any> {
    if (name !== "kairo_undo") return null;

    const { action = "history", limit = 5 } = args;

    try {
      switch (action) {
        case "undo": {
          const item = await this.context.historyEngine.undo();
          return this.jsonResponse(
            item
              ? { success: true, undone: item.description ?? item.id }
              : { success: false, hint: "Nothing to undo" },
          );
        }

        case "redo": {
          const item = await this.context.historyEngine.redo();
          return this.jsonResponse(
            item
              ? { success: true, redone: item.description ?? item.id }
              : { success: false, hint: "Nothing to redo" },
          );
        }

        case "history": {
          const state = await this.context.historyEngine.getHistory();
          return this.jsonResponse({
            undo: state.undoStack
              .slice(-limit)
              .reverse()
              .map((i: any) => ({
                id: i.id,
                description: i.description,
                timestamp: i.timestamp,
              })),
            redo: state.redoStack
              .slice(-limit)
              .reverse()
              .map((i: any) => ({
                id: i.id,
                description: i.description,
                timestamp: i.timestamp,
              })),
          });
        }

        default:
          return this.errorResponse(
            "InvalidAction",
            `Unknown action: ${action}. Use undo, redo, or history.`,
          );
      }
    } catch (error: any) {
      return this.errorResponse(
        "UndoError",
        error?.message ?? "Undo operation failed",
      );
    }
  }
}
