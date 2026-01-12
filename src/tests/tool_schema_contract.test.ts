import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { SmartContextServer } from "../index.js";

const parsePayload = (response: any) => {
  const text = response?.content?.[0]?.text ?? "{}";
  return JSON.parse(text);
};

describe("Tool schema contract", () => {
  it("exposes limits.maxTokens for explore/understand schemas", async () => {
    const originalStorageMode = process.env.KAIRO_STORAGE_MODE;
    process.env.KAIRO_STORAGE_MODE = "memory";
    const server = new SmartContextServer(process.cwd());
    const tools = (server as any).listIntentTools();

    const explore = tools.find((tool: any) => tool.name === "explore");
    const understand = tools.find((tool: any) => tool.name === "understand");

    expect(explore?.inputSchema?.properties?.limits?.properties?.maxTokens).toBeDefined();
    expect(understand?.inputSchema?.properties?.limits?.properties?.maxTokens).toBeDefined();

    await server.shutdown();
    if (originalStorageMode === undefined) {
      delete process.env.KAIRO_STORAGE_MODE;
    } else {
      process.env.KAIRO_STORAGE_MODE = originalStorageMode;
    }
  });

  it("applies file_read raw alias with contract findings in compat mode", async () => {
    const prevExpose = process.env.KAIRO_EXPOSE_FILE_TOOLS;
    const prevMode = process.env.KAIRO_TOOL_SCHEMA_MODE;
    const originalStorageMode = process.env.KAIRO_STORAGE_MODE;
    process.env.KAIRO_EXPOSE_FILE_TOOLS = "true";
    process.env.KAIRO_TOOL_SCHEMA_MODE = "compat";
    process.env.KAIRO_STORAGE_MODE = "memory";

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-contract-"));
    const filePath = path.join(tempDir, "sample.txt");
    fs.writeFileSync(filePath, "hello", "utf-8");

    const server = new SmartContextServer(tempDir);
    const response = await (server as any).handleCallTool("file_read", { filePath, raw: true });
    const payload = parsePayload(response);

    expect(payload.contract?.tool).toBe("file_read");
    expect(payload.contract?.findings?.some((finding: any) => finding.code === "DEPRECATED_FIELD_USED")).toBe(true);
    expect(payload.content).toBeDefined();

    await server.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (prevExpose === undefined) {
      delete process.env.KAIRO_EXPOSE_FILE_TOOLS;
    } else {
      process.env.KAIRO_EXPOSE_FILE_TOOLS = prevExpose;
    }
    if (prevMode === undefined) {
      delete process.env.KAIRO_TOOL_SCHEMA_MODE;
    } else {
      process.env.KAIRO_TOOL_SCHEMA_MODE = prevMode;
    }
    if (originalStorageMode === undefined) {
      delete process.env.KAIRO_STORAGE_MODE;
    } else {
      process.env.KAIRO_STORAGE_MODE = originalStorageMode;
    }
  });

  it("rejects unknown fields in strict mode", async () => {
    const prevMode = process.env.KAIRO_TOOL_SCHEMA_MODE;
    const originalStorageMode = process.env.KAIRO_STORAGE_MODE;
    process.env.KAIRO_TOOL_SCHEMA_MODE = "strict";
    process.env.KAIRO_STORAGE_MODE = "memory";
    const server = new SmartContextServer(process.cwd());

    const response = await (server as any).handleCallTool("explore", { unknownField: true });
    const payload = parsePayload(response);

    expect(response.isError).toBe(true);
    expect(payload.errorCode).toBe("InvalidArguments");

    await server.shutdown();
    if (prevMode === undefined) {
      delete process.env.KAIRO_TOOL_SCHEMA_MODE;
    } else {
      process.env.KAIRO_TOOL_SCHEMA_MODE = prevMode;
    }
    if (originalStorageMode === undefined) {
      delete process.env.KAIRO_STORAGE_MODE;
    } else {
      process.env.KAIRO_STORAGE_MODE = originalStorageMode;
    }
  });
});
