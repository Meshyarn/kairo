import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { SmartContextServer } from "../index.js";
import { NativeModuleLoader } from "../orchestration/capabilities/NativeModuleLoader.js";
import { NativeSearchCoreStub } from "./utils/NativeSearchCoreStub.js";

const parsePayload = (response: any) => {
  const text = response?.content?.[0]?.text ?? "{}";
  return JSON.parse(text);
};

describe("Tool schema contract", () => {
  beforeEach(() => {
    NativeModuleLoader.setTestLoader(() => ({
      SmartChunker: class {
        constructor(_modelPath: string) {}
        chunk(_text: string, _maxTokens: number, _overlap: number) { return []; }
      },
      diffUnified: (_oldText: string, _newText: string, _contextLines: number) => ({
        diff: "",
        added: 0,
        removed: 0
      }),
      validateSyntax: (_language: string, _content: string) => [],
      cosineScores: (_query: Float32Array, _vectors: Float32Array[]) => [],
      NativeSearchCore: class {
        private readonly core = new NativeSearchCoreStub();
        upsert(doc: any) { return this.core.upsert(doc); }
        upsertMany(docs: any[]) { return this.core.upsertMany(docs); }
        deleteDoc(target: any) { return this.core.deleteDoc(target); }
        commit() { return this.core.commit(); }
        search(query: any) { return this.core.search(query); }
        close() { return this.core.close(); }
        stats() { return this.core.stats(); }
        reset() { return this.core.reset(); }
      }
    }));
  });

  afterEach(() => {
    NativeModuleLoader.resetForTesting();
  });

  it("exposes limits.maxTokens for explore/understand schemas", async () => {
    const originalSurface = process.env.KAIRO_PUBLIC_SURFACE;
    const originalStorageMode = process.env.KAIRO_STORAGE_MODE;
    process.env.KAIRO_STORAGE_MODE = "memory";
    process.env.KAIRO_PUBLIC_SURFACE = "pillars";
    const server = new SmartContextServer(process.cwd());
    const tools = (server as any).listIntentTools();

    const explore = tools.find((tool: any) => tool.name === "explore");
    const understand = tools.find((tool: any) => tool.name === "understand");

    expect(explore?.inputSchema?.properties?.limits?.properties?.maxTokens).toBeDefined();
    expect(understand?.inputSchema?.properties?.limits?.properties?.maxTokens).toBeDefined();

    await server.shutdown();
    if (originalSurface === undefined) {
      delete process.env.KAIRO_PUBLIC_SURFACE;
    } else {
      process.env.KAIRO_PUBLIC_SURFACE = originalSurface;
    }
    if (originalStorageMode === undefined) {
      delete process.env.KAIRO_STORAGE_MODE;
    } else {
      process.env.KAIRO_STORAGE_MODE = originalStorageMode;
    }
  });

  it("attaches contract metadata only when trace=true", async () => {
    const prevMode = process.env.KAIRO_TOOL_SCHEMA_MODE;
    const originalStorageMode = process.env.KAIRO_STORAGE_MODE;
    process.env.KAIRO_TOOL_SCHEMA_MODE = "compat";
    process.env.KAIRO_STORAGE_MODE = "memory";

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-contract-"));
    const filePath = path.join(tempDir, "sample.ts");
    fs.writeFileSync(filePath, "hello", "utf-8");

    const server = new SmartContextServer(tempDir);
    const response = await (server as any).handleCallTool("task", {
      request: "find sample",
      files: [filePath],
      trace: true
    });
    const payload = parsePayload(response);

    expect(payload.contract?.tool).toBe("task");
    expect(payload.contract?.findings?.some((finding: any) => finding.code === "SCHEMA_ALIAS_USED")).toBe(true);

    await server.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
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

  it("omits contract metadata when trace is not enabled", async () => {
    const prevMode = process.env.KAIRO_TOOL_SCHEMA_MODE;
    const originalStorageMode = process.env.KAIRO_STORAGE_MODE;
    process.env.KAIRO_TOOL_SCHEMA_MODE = "compat";
    process.env.KAIRO_STORAGE_MODE = "memory";
    const server = new SmartContextServer(process.cwd());

    const response = await (server as any).handleCallTool("task", {
      request: "find app",
      budget: "deep"
    });
    const payload = parsePayload(response);

    expect(payload.contract).toBeUndefined();

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
