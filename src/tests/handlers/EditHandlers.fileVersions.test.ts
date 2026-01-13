import { describe, beforeEach, afterEach, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SmartContextServer } from "../../index.js";

const runTool = async (server: SmartContextServer, toolName: string, args: any) => {
  const response = await (server as any).handleCallTool(toolName, args);
  expect(response).toBeDefined();
  if (response.isError) return response;
  return JSON.parse(response.content[0].text);
};

describe("EditHandlers fileVersions", () => {
  let server: SmartContextServer;
  let testRoot: string;
  let relPath: string;

  beforeEach(async () => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "edit-handler-version-"));
    fs.mkdirSync(path.join(testRoot, "src"), { recursive: true });
    relPath = path.join("src", "file.ts");
    fs.writeFileSync(path.join(testRoot, relPath), 'export const value = "original";\n');
    server = new SmartContextServer(testRoot);
  });

  afterEach(async () => {
    await server.shutdown();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it("blocks edit_apply when fileVersions mismatch", async () => {
    const read = await runTool(server, "file_read", { filePath: relPath, full: true });
    const expectedHash = read.versionInfo?.contentHash;
    expect(expectedHash).toBeDefined();

    fs.writeFileSync(path.join(testRoot, relPath), 'export const value = "changed";\n');

    const result = await runTool(server, "edit_apply", {
      edits: [
        {
          filePath: relPath,
          targetString: 'export const value = "changed";',
          replacementString: 'export const value = "next";'
        }
      ],
      dryRun: false,
      fileVersions: {
        [relPath]: { expectedHash }
      }
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("FILE_VERSION_MISMATCH");
    expect(result.updatedFileStates?.[relPath]?.newHash).toBeDefined();
  });

  it("allows edit_apply when fileVersions match", async () => {
    const read = await runTool(server, "file_read", { filePath: relPath, full: true });
    const expectedHash = read.versionInfo?.contentHash;
    const expectedVersion = read.versionInfo?.version;
    expect(expectedHash).toBeDefined();
    expect(typeof expectedVersion).toBe("number");

    const result = await runTool(server, "edit_apply", {
      edits: [
        {
          filePath: relPath,
          targetString: 'export const value = "original";',
          replacementString: 'export const value = "new";'
        }
      ],
      dryRun: false,
      fileVersions: {
        [relPath]: { expectedHash, expectedVersion }
      }
    });

    expect(result.success).toBe(true);
    expect(result.updatedFileStates?.[relPath]?.newHash).toBeDefined();
  });
});
