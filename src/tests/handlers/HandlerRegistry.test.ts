import { describe, it, expect } from "@jest/globals";
import { HandlerRegistry } from "../../handlers/HandlerRegistry.js";

class NullHandler {
    async handle(): Promise<any> {
        return null;
    }
}

class EchoHandler {
    async handle(name: string, args: any): Promise<any> {
        if (name === "echo") {
            return { name, args };
        }
        return null;
    }
}

describe("HandlerRegistry", () => {
    it("routes tool calls to the first matching handler", async () => {
        const registry = new HandlerRegistry();
        registry.register(new NullHandler());
        registry.register(new EchoHandler());

        const result = await registry.handle("echo", { value: 1 });
        expect(result).toEqual({ name: "echo", args: { value: 1 } });
    });

    it("returns null when no handler matches", async () => {
        const registry = new HandlerRegistry();
        registry.register(new NullHandler());
        const result = await registry.handle("unknown", {});
        expect(result).toBeNull();
    });
});
