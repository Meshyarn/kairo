import { describe, it, expect, jest } from "@jest/globals";
import { TaskHandlers } from "../../handlers/TaskHandlers.js";
import { PathManager } from "../../utils/PathManager.js";
import { MemoryFileSystem } from "../../platform/FileSystem.js";
import { PathNormalizer } from "../../utils/PathNormalizer.js";
import { FileVersionManager } from "../../engine/FileVersionManager.js";
import { makeContext, makeTempRoot, writeMcpConfig } from "./TaskHandlersTestUtils.js";

describe("TaskHandlers verification and auto-repair", () => {
  it("verifies file content against draft pack", async () => {
    const tempRoot = makeTempRoot();
    const fileSystem = new MemoryFileSystem(tempRoot);
    await fileSystem.writeFile("src/app.ts", "export const bar = 2;");
    const pathNormalizer = new PathNormalizer(tempRoot);
    const fileVersionManager = new FileVersionManager(fileSystem);
    const absPath = pathNormalizer.toAbsolute("src/app.ts");
    const versionInfo = await fileVersionManager.getVersion(absPath);
    const draftPack = {
      id: "draft_verify_1",
      phantomFiles: [{ path: "src/app.ts", content: "export const bar = 2;" }],
      fileVersions: {
        "src/app.ts": {
          expectedVersion: versionInfo.version,
          expectedHash: versionInfo.contentHash
        }
      }
    };
    const flowArtifactManager = {
      get: jest.fn(() => ({ type: "draft", pack: draftPack }))
    };
    const context = makeContext({ fileSystem, pathNormalizer, fileVersionManager, flowArtifactManager });
    const handler = new TaskHandlers(context as any);

    const response = await handler.handle("task", {
      request: "verify",
      mode: "verify",
      targetFiles: ["src/app.ts"],
      draftId: "draft_verify_1"
    });
    const payload = JSON.parse(response.content[0].text);

    expect(payload.status).toBe("success");
    expect(payload.verification?.contentMatch).toBe(true);
    expect(payload.verification?.fileVersionMatch).toBeUndefined();
  });

  it("auto-repairs file version mismatch with preview refresh", async () => {
    const originalRoot = process.cwd();
    const tempRoot = makeTempRoot();
    PathManager.setRoot(tempRoot);
    writeMcpConfig(tempRoot, {
      mode: "mcp",
      autopilot: {
        maxAutoRepairAttempts: 1,
        allowAutoReindex: false
      }
    });
    const context = makeContext({ rootPath: tempRoot });
    const handler = new TaskHandlers(context as any);
    const changeResponse = {
      success: false,
      status: "blocked",
      blockedReason: "file_version_mismatch",
      degradedReasons: [{ type: "degraded", message: "file_version_mismatch", filePath: "src/app.ts" }],
      sessionId: "s6"
    };
    const exploreResponse = {
      success: true,
      status: "ok",
      data: { docs: [], code: [] },
      pack: { packId: "pack_3", hit: false, createdAt: Date.now() },
      sessionId: "s6"
    };
    context.orchestrationEngine.executePillar
      .mockResolvedValueOnce(changeResponse)
      .mockResolvedValueOnce(exploreResponse);

    try {
      const response = await handler.handle("task", {
        request: "apply plan",
        mode: "apply_change",
        budget: "lean"
      });
      const payload = JSON.parse(response.content[0].text);

      expect(context.orchestrationEngine.executePillar).toHaveBeenNthCalledWith(
        1,
        "change",
        expect.objectContaining({ intent: "apply plan", safety: "apply" })
      );
      expect(context.orchestrationEngine.executePillar).toHaveBeenNthCalledWith(
        2,
        "explore",
        expect.objectContaining({ paths: ["src/app.ts"], view: "preview", sessionId: "s6" })
      );
      expect(payload.autoRepair?.attempts?.[0]?.tool).toBe("explore");
      expect(payload.autoRepair?.attempts?.[0]?.packId).toBe("pack_3");
    } finally {
      PathManager.setRoot(originalRoot);
    }
  });

  it("auto-repairs stale index with path reindex", async () => {
    const originalRoot = process.cwd();
    const tempRoot = makeTempRoot();
    PathManager.setRoot(tempRoot);
    writeMcpConfig(tempRoot, {
      mode: "mcp",
      autopilot: {
        maxAutoRepairAttempts: 1,
        allowAutoReindex: true
      }
    });
    const indexStateManager = { getDirtyFiles: jest.fn(() => ["src/a.ts", "src/b.ts"]) };
    const context = makeContext({ indexStateManager, rootPath: tempRoot });
    const handler = new TaskHandlers(context as any);
    const changeResponse = {
      success: false,
      status: "blocked",
      blockedReason: "index_stale_high",
      indexSnapshot: { dirtyFileCount: 2 },
      sessionId: "s7"
    };
    const manageResponse = {
      success: true,
      output: "Reindex enqueued (paths).",
      scope: "paths",
      paths: ["src/a.ts", "src/b.ts"]
    };
    context.orchestrationEngine.executePillar
      .mockResolvedValueOnce(changeResponse)
      .mockResolvedValueOnce(manageResponse);

    try {
      const response = await handler.handle("task", {
        request: "apply plan",
        mode: "apply_change",
        budget: "lean"
      });
      const payload = JSON.parse(response.content[0].text);

      expect(indexStateManager.getDirtyFiles).toHaveBeenCalled();
      expect(context.orchestrationEngine.executePillar).toHaveBeenNthCalledWith(
        2,
        "manage",
        expect.objectContaining({ command: "reindex", paths: ["src/a.ts", "src/b.ts"] })
      );
      expect(payload.autoRepair?.attempts?.[0]?.tool).toBe("manage");
    } finally {
      PathManager.setRoot(originalRoot);
    }
  });

  it("auto-verifies apply_change responses when possible", async () => {
    const fileSystem = new MemoryFileSystem();
    await fileSystem.writeFile("src/app.ts", "export const value = 2;\n");
    const draftPack = {
      id: "draft_apply_verify_1",
      phantomFiles: [{ path: "src/app.ts", content: "export const value = 2;\n", isNew: false, language: "ts" }]
    };
    const flowArtifactManager = {
      get: jest.fn((id: string) => (id === "draft_apply_verify_1" ? { type: "draft", pack: draftPack } : undefined))
    };
    const context = makeContext({ fileSystem, flowArtifactManager });
    const handler = new TaskHandlers(context as any);
    const changeResponse = {
      success: true,
      status: "ok",
      targetFile: "src/app.ts",
      sessionId: "s-apply-verify"
    };
    context.orchestrationEngine.executePillar.mockResolvedValue(changeResponse);

    const response = await handler.handle("task", {
      request: "apply plan",
      mode: "apply_change",
      budget: "balanced",
      draftId: "draft_apply_verify_1",
      applyToken: "token_1",
      targetFiles: ["src/app.ts"]
    });
    const payload = JSON.parse(response.content[0].text);

    expect(payload.status).toBe("success");
    expect(payload.verification?.contentMatch).toBe(true);
    expect(payload.summary.bullets.some((bullet: string) => bullet.includes("Auto-verify:"))).toBe(true);
  });

  it("auto-verifies write apply responses when possible", async () => {
    const fileSystem = new MemoryFileSystem();
    await fileSystem.writeFile("src/new.ts", "export const generated = 123;\n");
    const draftPack = {
      id: "draft_write_verify_1",
      phantomFiles: [{ path: "src/new.ts", content: "export const generated = 123;\n", isNew: true, language: "ts" }]
    };
    const flowArtifactManager = {
      get: jest.fn((id: string) => (id === "draft_write_verify_1" ? { type: "draft", pack: draftPack } : undefined))
    };
    const context = makeContext({ fileSystem, flowArtifactManager });
    const handler = new TaskHandlers(context as any);
    const writeResponse = {
      success: true,
      status: "ok",
      draftPack: { id: "draft_write_verify_1" },
      sessionId: "s-write-verify"
    };
    context.orchestrationEngine.executePillar.mockResolvedValue(writeResponse);

    const response = await handler.handle("task", {
      request: "apply write",
      mode: "write",
      safety: "apply",
      budget: "balanced",
      targetPath: "src/new.ts",
      draftId: "draft_write_verify_1",
      applyToken: "token_write_1"
    });
    const payload = JSON.parse(response.content[0].text);

    expect(payload.status).toBe("success");
    expect(payload.verification?.contentMatch).toBe(true);
    expect(payload.summary.bullets.some((bullet: string) => bullet.includes("Auto-verify:"))).toBe(true);
  });
});
