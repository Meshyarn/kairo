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
    fileVersionManager: { incrementVersion: jest.fn() } as any,
    indexStateManager: { markDirty: jest.fn(), clearDirty: jest.fn() } as any,
    incrementalIndexer: { enqueuePaths: jest.fn(), notifyDeletion: jest.fn() } as any,
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
    // Branch: large file requires confirmation
    context.fileSystem.stat.mockResolvedValue({ size: 20000 });
    const argsConfirm = {
      edits: [{ operation: "delete", filePath: "large.ts" }]
    };
    const res1 = await (handlers as any).editCodeRaw(argsConfirm);
    expect(res1.results[0].requiresConfirmation).toBe(true);

    // Branch: force delete ignoring size
    const argsForce = {
      edits: [{ operation: "delete", filePath: "large.ts", safetyLevel: "force" }],
      dryRun: false
    };
    await (handlers as any).editCodeRaw(argsForce);
    expect(context.fileSystem.deleteFile).toHaveBeenCalled();

    // Branch: hash mismatch blocks deletion
    context.fileSystem.stat.mockResolvedValue({ size: 100 });
    context.fileSystem.readFile.mockResolvedValue("actual content");
    const argsHash = {
      edits: [{ operation: "delete", filePath: "small.ts", confirmationHash: "wrong-hash" }]
    };
    const resHash = await (handlers as any).editCodeRaw(argsHash);
    expect(resHash.results[0].hashMismatch).toBe(true);
  });

  it("covers edit_apply batching branches", async () => {
    // Branch: single file entry
    const argsSingle = {
      edits: [{ filePath: "a.ts", targetString: "a", replacementString: "b" }]
    };
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
    context.editCoordinator.applyBatchEdits.mockResolvedValue({ success: true });
    await (handlers as any).editCodeRaw(argsBatch);
    expect(context.editCoordinator.applyBatchEdits).toHaveBeenCalled();
  });

  it("covers executeEditCoordinator targetPath branches", async () => {
    // Branch: has targetPath
    const argsTarget = { filePath: "a.ts", edits: [{ targetString: "a" }] };
    await (handlers as any).executeEditCoordinator(argsTarget);
    expect(context.editCoordinator.applyEdits).toHaveBeenCalled();

    // Branch: no targetPath, use edits to group
    context.editCoordinator.applyBatchEdits.mockClear();
    const argsGroup = { edits: [{ filePath: "b.ts", targetString: "b" }, { filePath: "c.ts" }] };
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
