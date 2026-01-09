import { describe, it, expect } from "@jest/globals";
import { InternalToolRegistry } from "../../orchestration/InternalToolRegistry.js";
import { IntegrityHandlers } from "../../handlers/IntegrityHandlers.js";
import type { HandlerContext } from "../../handlers/HandlerContext.js";

describe("IntegrityHandlers", () => {
    it("returns an error when query is missing", async () => {
        const registry = new InternalToolRegistry();
        const context = { internalRegistry: registry } as HandlerContext;
        const handler = new IntegrityHandlers(context);
        const result = await handler.handle("integrity_check", {});
        expect(result?.isError).toBe(true);
    });

    it("runs integrity check using internal tools", async () => {
        const registry = new InternalToolRegistry();
        registry.register("document_search", async () => ({
            results: [],
            evidence: [],
            pack: { packId: "pack-1" }
        }));
        registry.register("code_read", async () => "const value = 1;");

        const context = { internalRegistry: registry } as HandlerContext;
        const handler = new IntegrityHandlers(context);
        const result = await handler.handle("integrity_check", { query: "must" });
        const payload = JSON.parse(result.content[0].text);
        expect(payload?.report).toBeDefined();
        expect(payload?.report?.status).toBeDefined();
    });
});
