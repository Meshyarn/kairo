export interface ToolHandler {
    handle(name: string, args: any): Promise<any>;
}

export class HandlerRegistry {
    private handlers: ToolHandler[] = [];

    public register(handler: ToolHandler): void {
        this.handlers.push(handler);
    }

    public async handle(name: string, args: any): Promise<any> {
        for (const handler of this.handlers) {
            const result = await handler.handle(name, args);
            if (result !== null && result !== undefined) {
                return result;
            }
        }
        return null;
    }
}
