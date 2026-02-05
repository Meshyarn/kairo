import { describe, it, expect, jest } from "@jest/globals";
import { TaskHandlers } from "../../handlers/TaskHandlers.js";
import { makeContext } from "./TaskHandlersTestUtils.js";

describe("TaskHandlers evidence", () => {
  it("adds evidence pack for deep ask responses", async () => {
    const flowArtifactManager = { store: jest.fn((artifact: any) => artifact.id) };
    const context = makeContext({ flowArtifactManager });
    const handler = new TaskHandlers(context as any);
    const exploreResponse = {
      success: true,
      status: "ok",
      data: {
        docs: [],
        code: [
          { kind: "file_preview", filePath: "src/app.ts", preview: "export const app = 1;" },
          { kind: "file_preview", filePath: "src/utils.ts", preview: "export const util = () => {};" }
        ]
      },
      pack: { packId: "pack_1", hit: false, createdAt: Date.now() },
      sessionId: "s-evidence"
    };
    context.orchestrationEngine.executePillar.mockResolvedValue(exploreResponse);

    const response = await handler.handle("task", { request: "find app", budget: "deep" });
    const payload = JSON.parse(response.content[0].text);

    expect(payload.evidence?.length).toBeGreaterThan(0);
    expect(payload.artifacts?.some((artifact: any) => artifact.kind === "evidence")).toBe(true);
    expect(flowArtifactManager.store).toHaveBeenCalled();
    const storedArtifact = (flowArtifactManager.store as jest.Mock).mock.calls[0][0] as any;
    expect(storedArtifact.type).toBe("evidence");
    expect(storedArtifact.sessionId).toBe("s-evidence");
    expect(typeof storedArtifact.expiresAt).toBe("number");
  });

  it("adds evidence pack for deep analyze responses", async () => {
    const flowArtifactManager = { store: jest.fn((artifact: any) => artifact.id) };
    const context = makeContext({ flowArtifactManager });
    const handler = new TaskHandlers(context as any);
    const understandResponse = {
      success: true,
      status: "ok",
      summary: "Analysis results for core.",
      primaryFile: "src/core.ts",
      symbols: [],
      dependencies: [],
      sessionId: "s-evidence-2"
    };
    context.orchestrationEngine.executePillar.mockResolvedValue(understandResponse);

    const response = await handler.handle("task", { request: "core analysis", mode: "analyze", budget: "deep" });
    const payload = JSON.parse(response.content[0].text);

    expect(payload.evidence?.length).toBeGreaterThan(0);
    expect(payload.artifacts?.some((artifact: any) => artifact.kind === "evidence")).toBe(true);
    const storedArtifact = (flowArtifactManager.store as jest.Mock).mock.calls[0][0] as any;
    expect(storedArtifact.type).toBe("evidence");
    expect(storedArtifact.sessionId).toBe("s-evidence-2");
  });

  it("surfaces targetString candidates in change prep when anchor text is available", async () => {
    const context = makeContext();
    const handler = new TaskHandlers(context as any);
    const exploreResponse = {
      success: true,
      status: "ok",
      data: {
        docs: [],
        code: [{ kind: "file_full", filePath: "src/app.ts", content: "export const foo = 1;" }]
      },
      pack: { packId: "pack_targets", hit: false, createdAt: Date.now() },
      sessionId: "s3b"
    };
    context.orchestrationEngine.executePillar.mockResolvedValue(exploreResponse);

    const response = await handler.handle("task", { request: "update app", mode: "plan_change", budget: "balanced" });
    const payload = JSON.parse(response.content[0].text);

    expect(payload.changePrep?.targetStringCandidates?.length).toBeGreaterThan(0);
    expect(payload.changePrep?.targetStringCandidates?.[0]?.anchorText).toContain("export const foo");
  });

  it("adds prep evidence for write plan without content", async () => {
    const context = makeContext();
    const handler = new TaskHandlers(context as any);
    const exploreResponse = {
      success: true,
      status: "ok",
      data: {
        docs: [],
        code: [{ kind: "file_preview", filePath: "src/template.ts", preview: "export const template = 1;" }]
      },
      pack: { packId: "pack_write", hit: false, createdAt: Date.now() },
      sessionId: "s-write"
    };
    const writeResponse = {
      success: true,
      status: "draft",
      draftPack: { id: "draft_write_3" },
      sessionId: "s-write"
    };
    context.orchestrationEngine.executePillar
      .mockResolvedValueOnce(exploreResponse)
      .mockResolvedValueOnce(writeResponse);

    const response = await handler.handle("task", {
      request: "Create component",
      mode: "write",
      budget: "balanced",
      targetFiles: ["src/new.ts"]
    });
    const payload = JSON.parse(response.content[0].text);

    expect(context.orchestrationEngine.executePillar).toHaveBeenNthCalledWith(
      1,
      "explore",
      expect.objectContaining({ query: "Create component", view: "preview" })
    );
    expect(context.orchestrationEngine.executePillar).toHaveBeenNthCalledWith(
      2,
      "write",
      expect.objectContaining({ intent: "Create component", targetPath: "src/new.ts", smartWrite: true })
    );
    expect(payload.evidence?.length).toBeGreaterThan(0);
    expect(payload.summary.bullets.some((bullet: string) => bullet.includes("Prep evidence"))).toBe(true);
  });
});
