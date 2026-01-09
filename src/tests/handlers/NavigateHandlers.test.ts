import { describe, it, expect } from "@jest/globals";
import { NavigateHandlers } from "../../handlers/NavigateHandlers.js";
import type { HandlerContext } from "../../handlers/HandlerContext.js";

describe("NavigateHandlers", () => {
    it("delegates navigate pillar calls to orchestration engine", async () => {
        const calls: Array<[string, any]> = [];
        const orchestrationEngine = {
            executePillar: async (name: string, args: any) => {
                calls.push([name, args]);
                return { ok: true };
            }
        } as any;
        const context = { orchestrationEngine } as HandlerContext;
        const handler = new NavigateHandlers(context);
        const result = await handler.handle("navigate", { target: "UserService" });
        expect(calls).toEqual([["navigate", { target: "UserService" }]]);
        const payload = JSON.parse(result.content[0].text);
        expect(payload?.ok).toBe(true);
    });
});
