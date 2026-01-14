import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { EditHandlers } from "../../handlers/EditHandlers.js";
import { NodeFileSystem } from "../../platform/FileSystem.js";
import { PathNormalizer } from "../../utils/PathNormalizer.js";

const makeContext = () => {
  const fs = {
    writeFile: jest.fn(),
    deleteFile: jest.fn(),
    createDir: jest.fn(),
    stat: jest.fn(),
    exists: jest.fn(async () => false),
    readFile: jest.fn()
  };
  const coordinator = {
    applyEdits: jest.fn(),
    applyBatchEdits: jest.fn()
  };
  return {
    fileSystem: fs as any,
    editCoordinator: coordinator as any,
    pathNormalizer: new PathNormalizer("/root"),
    fileVersionManager: { incrementVersion: jest.fn(() => ({ version: 1, contentHash: "hash" })) } as any,
    indexStateManager: { markDirty: jest.fn(), clearDirty: jest.fn() } as any,
    incrementalIndexer: { enqueuePaths: jest.fn(), notifyDeletion: jest.fn() } as any,
    historyEngine: { pushOperation: jest.fn() } as any,
    orchestrationEngine: { executePillar: jest.fn() } as any
  };
};

describe("EditHandlers Branches", () => {
  let handlers: EditHandlers;
  let context: any;

  beforeEach(() => {
    context = makeContext();
    handlers = new EditHandlers(context);
  });

  it("covers edit_apply operation=create branches", async () => {
    context.fileSystem.exists.mockResolvedValue(false);
    const args = {
      edits: [
        { operation: "create", filePath: "new.ts", replacementString: "content" }
      ],
      dryRun: false,
      createMissingDirectories: true
    };

    const result = await (handlers as any).editCodeRaw(args);
    expect(context.fileSystem.createDir).toHaveBeenCalled();
    expect(context.fileSystem.writeFile).toHaveBeenCalledWith(expect.any(String), "content");
    expect(result.results[0].applied).toBe(true);
  });

  it("covers edit_apply operation=delete safety branches", async () => {
    context.fileSystem.exists.mockResolvedValue(true);
    context.fileSystem.readFile.mockResolvedValue("actual content");

    // Branch: delete requires confirmation hash
    const argsConfirm = {
      edits: [{ operation: "delete", filePath: "large.ts" }],
      options: { deleteMode: "confirm" }
    };
    const res1 = await (handlers as any).editCodeRaw(argsConfirm);
    expect(res1.results[0].status).toBe("confirmation_required");

    // Branch: confirmation hash mismatch blocks deletion
    const argsHash = {
      edits: [{ operation: "delete", filePath: "small.ts", confirmationHash: "wrong-hash" }],
      options: { deleteMode: "confirm" }
    };
    const resHash = await (handlers as any).editCodeRaw(argsHash);
    expect(resHash.results[0].errorCode).toBe("DELETE_HASH_MISMATCH");

    // Branch: delete succeeds with confirmation hash
    const crypto = await import("crypto");
    const hash = crypto.createHash("sha256").update("actual content").digest("hex");
    const argsDelete = {
      edits: [{ operation: "delete", filePath: "ok.ts", confirmationHash: hash }],
      options: { deleteMode: "confirm" },
      dryRun: false
    };
    await (handlers as any).editCodeRaw(argsDelete);
    expect(context.fileSystem.deleteFile).toHaveBeenCalled();
  });

  it("covers edit_apply batching branches", async () => {
    // Branch: single file entry
    const argsSingle = {
      edits: [{ filePath: "a.ts", targetString: "a", replacementString: "b" }]
    };
    context.fileSystem.exists.mockResolvedValue(true);
    context.editCoordinator.applyEdits.mockResolvedValue({ success: true, diff: "diff" });
    await (handlers as any).editCodeRaw(argsSingle);
    expect(context.editCoordinator.applyEdits).toHaveBeenCalled();

    // Branch: multiple file entries
    const argsBatch = {
      edits: [
        { filePath: "a.ts", targetString: "a", replacementString: "b" },
        { filePath: "b.ts", targetString: "c", replacementString: "d" }
      ]
    };
    context.fileSystem.exists.mockResolvedValue(true);
    context.editCoordinator.applyEdits.mockResolvedValue({ success: true });
    context.editCoordinator.applyBatchEdits.mockResolvedValue({ success: true });
    await (handlers as any).editCodeRaw(argsBatch);
    expect(context.editCoordinator.applyBatchEdits).toHaveBeenCalled();
  });

  it("covers executeEditCoordinator targetPath branches", async () => {
    // Branch: has targetPath
    const argsTarget = { filePath: "a.ts", edits: [{ targetString: "a" }] };
    context.fileSystem.exists.mockResolvedValue(true);
    context.editCoordinator.applyEdits.mockResolvedValue({ success: true });
    await (handlers as any).executeEditCoordinator(argsTarget);
    expect(context.editCoordinator.applyEdits).toHaveBeenCalled();

    // Branch: no targetPath, use edits to group
    context.editCoordinator.applyBatchEdits.mockClear();
    const argsGroup = { edits: [{ filePath: "b.ts", targetString: "b" }, { filePath: "c.ts" }] };
    context.fileSystem.exists.mockResolvedValue(true);
    context.editCoordinator.applyBatchEdits.mockResolvedValue({ success: true });
    await (handlers as any).executeEditCoordinator(argsGroup);
    expect(context.editCoordinator.applyBatchEdits).toHaveBeenCalled();
  });

  it("covers handle missing parameter branches", async () => {
    const resPillar = await handlers.handle("change", {});
    expect(resPillar.isError).toBe(true);
    expect(resPillar.content[0].text).toContain("MissingParameter");

    const resLegacy = await handlers.handle("file_edit", {});
    expect(resLegacy.isError).toBe(true);
  });
});
