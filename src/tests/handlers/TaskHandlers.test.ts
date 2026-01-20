import { describe, it, expect, jest } from "@jest/globals";
import { TaskHandlers } from "../../handlers/TaskHandlers.js";
import { createDefaultToolSpecRegistry } from "../../server/tools/ToolSpecRegistry.js";

const makeContext = () => {
    const executePillar = jest.fn<(...args: any[]) => Promise<any>>();
    return {
        rootPath: process.cwd(),
        orchestrationEngine: { executePillar },
        toolSpecRegistry: createDefaultToolSpecRegistry(),
        isTestEnv: () => true
    };
};

describe("TaskHandlers", () => {
    it("routes ask to explore and returns summary", async () => {
        const context = makeContext();
        const handler = new TaskHandlers(context as any);
        const exploreResponse = {
            success: true,
            status: "ok",
            data: { docs: [], code: [{ kind: "file_preview", filePath: "src/app.ts" }] },
            pack: { packId: "pack_1", hit: false, createdAt: Date.now() },
            sessionId: "s1"
        };
        context.orchestrationEngine.executePillar.mockResolvedValue(exploreResponse);

        const response = await handler.handle("task", { request: "find app" });
        const payload = JSON.parse(response.content[0].text);

        expect(context.orchestrationEngine.executePillar).toHaveBeenCalledWith(
            "explore",
            expect.objectContaining({ query: "find app", profile: "lean", view: "preview" })
        );
        expect(payload.summary.title).toContain("find app");
        expect(payload.packId).toBe("pack_1");
        expect(payload.status).toBe("success");
    });

    it("routes analyze to understand and returns summary", async () => {
        const context = makeContext();
        const handler = new TaskHandlers(context as any);
        const understandResponse = {
            success: true,
            status: "ok",
            summary: "Analysis results for \"core\".",
            primaryFile: "src/core.ts",
            symbols: [],
            dependencies: [],
            sessionId: "s2"
        };
        context.orchestrationEngine.executePillar.mockResolvedValue(understandResponse);

        const response = await handler.handle("task", { request: "core structure", mode: "analyze" });
        const payload = JSON.parse(response.content[0].text);

        expect(context.orchestrationEngine.executePillar).toHaveBeenCalledWith(
            "understand",
            expect.objectContaining({ goal: "core structure", profile: "lean" })
        );
        expect(payload.summary.title).toContain("core structure");
        expect(payload.status).toBe("success");
    });
});
