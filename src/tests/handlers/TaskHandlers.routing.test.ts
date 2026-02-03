import { describe, it, expect } from "@jest/globals";
import { TaskHandlers } from "../../handlers/TaskHandlers.js";
import { makeContext } from "./TaskHandlersTestUtils.js";

describe("TaskHandlers routing", () => {
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
    expect(payload.status).toBe("partial_success");
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

  it("runs composite explore→understand when evidence is insufficient", async () => {
    const context = makeContext();
    const handler = new TaskHandlers(context as any);
    const exploreResponse = {
      success: true,
      status: "ok",
      data: { docs: [], code: [{ kind: "file_preview", filePath: "src/app.ts", preview: "export const app = 1;" }] },
      pack: { packId: "pack_comp", hit: false, createdAt: Date.now() },
      sessionId: "s-comp"
    };
    const understandResponse = {
      success: true,
      status: "ok",
      summary: "Analysis results for app.",
      primaryFile: "src/app.ts",
      symbols: [],
      dependencies: [],
      sessionId: "s-comp"
    };
    context.orchestrationEngine.executePillar
      .mockResolvedValueOnce(exploreResponse)
      .mockResolvedValueOnce(understandResponse);

    const response = await handler.handle("task", { request: "app details", budget: "balanced", mode: "ask" });
    const payload = JSON.parse(response.content[0].text);

    expect(context.orchestrationEngine.executePillar).toHaveBeenNthCalledWith(
      1,
      "explore",
      expect.objectContaining({ query: "app details", view: "preview" })
    );
    expect(context.orchestrationEngine.executePillar).toHaveBeenNthCalledWith(
      2,
      "understand",
      expect.objectContaining({ goal: "app details", targetFiles: ["src/app.ts"] })
    );
    expect(payload.summary.bullets.some((bullet: string) => bullet.startsWith("Deep analysis:"))).toBe(true);
    expect(payload.status).toBe("partial_success");
  });

  it("returns change prep when plan_change has no edits", async () => {
    const context = makeContext();
    const handler = new TaskHandlers(context as any);
    const exploreResponse = {
      success: true,
      status: "ok",
      data: { docs: [], code: [{ kind: "file_preview", filePath: "src/app.ts" }] },
      pack: { packId: "pack_2", hit: false, createdAt: Date.now() },
      sessionId: "s3"
    };
    context.orchestrationEngine.executePillar.mockResolvedValue(exploreResponse);

    const response = await handler.handle("task", { request: "update app", mode: "plan_change" });
    const payload = JSON.parse(response.content[0].text);

    expect(context.orchestrationEngine.executePillar).toHaveBeenCalledWith(
      "explore",
      expect.objectContaining({ query: "update app", view: "preview" })
    );
    expect(payload.status).toBe("partial_success");
    expect(payload.changePrep?.recommendedTargets).toContain("src/app.ts");
    expect(payload.packId).toBe("pack_2");
  });

  it("routes plan_change with edits to change plan", async () => {
    const context = makeContext();
    const handler = new TaskHandlers(context as any);
    const changeResponse = {
      success: true,
      status: "ok",
      draftPack: { id: "draft_1", intent: "update", status: "pending", createdAt: Date.now() },
      applyToken: "token_1",
      sessionId: "s4"
    };
    context.orchestrationEngine.executePillar.mockResolvedValue(changeResponse);

    const response = await handler.handle("task", {
      request: "update app",
      mode: "plan_change",
      edits: [{ targetString: "old", replacementString: "new" }],
      targetFiles: ["src/app.ts"]
    });
    const payload = JSON.parse(response.content[0].text);

    expect(context.orchestrationEngine.executePillar).toHaveBeenCalledWith(
      "change",
      expect.objectContaining({ intent: "update app", safety: "plan" })
    );
    expect(payload.draftId).toBe("draft_1");
    expect(payload.applyToken).toBe("token_1");
    expect(payload.status).toBe("success");
  });

  it("routes apply_change to change apply with token", async () => {
    const context = makeContext();
    const handler = new TaskHandlers(context as any);
    const changeResponse = {
      success: true,
      status: "ok",
      review: { id: "review_1" },
      sessionId: "s5"
    };
    context.orchestrationEngine.executePillar.mockResolvedValue(changeResponse);

    const response = await handler.handle("task", {
      request: "apply plan",
      mode: "apply_change",
      draftId: "draft_1",
      applyToken: "token_1"
    });
    const payload = JSON.parse(response.content[0].text);

    expect(context.orchestrationEngine.executePillar).toHaveBeenCalledWith(
      "change",
      expect.objectContaining({ intent: "apply plan", safety: "apply", draftId: "draft_1", applyToken: "token_1" })
    );
    expect(payload.status).toBe("success");
  });

  it("routes write to write pillar with extracted content", async () => {
    const context = makeContext();
    const handler = new TaskHandlers(context as any);
    const writeResponse = {
      success: true,
      status: "draft",
      draftPack: { id: "draft_write_1" },
      applyToken: "token_write_1",
      sessionId: "s5w"
    };
    context.orchestrationEngine.executePillar.mockResolvedValue(writeResponse);

    const request = "Create file\n```ts\nexport const foo = 1;\n```";
    const response = await handler.handle("task", {
      request,
      mode: "write",
      targetFiles: ["src/foo.ts"]
    });
    const payload = JSON.parse(response.content[0].text);

    expect(context.orchestrationEngine.executePillar).toHaveBeenCalledWith(
      "write",
      expect.objectContaining({
        intent: request,
        targetPath: "src/foo.ts",
        content: "export const foo = 1;",
        safety: "plan"
      })
    );
    expect(payload.draftId).toBe("draft_write_1");
    expect(payload.applyToken).toBe("token_write_1");
    expect(payload.status).toBe("success");
  });

  it("accepts targetPath alias for write", async () => {
    const context = makeContext();
    const handler = new TaskHandlers(context as any);
    const writeResponse = {
      success: true,
      status: "draft",
      draftPack: { id: "draft_write_2" },
      sessionId: "s5w2"
    };
    context.orchestrationEngine.executePillar.mockResolvedValue(writeResponse);

    const response = await handler.handle("task", {
      request: "Create file",
      mode: "write",
      targetPath: "src/alias.ts"
    });
    const payload = JSON.parse(response.content[0].text);

    expect(context.orchestrationEngine.executePillar).toHaveBeenCalledWith(
      "write",
      expect.objectContaining({ targetPath: "src/alias.ts" })
    );
    expect(payload.draftId).toBe("draft_write_2");
  });
});
