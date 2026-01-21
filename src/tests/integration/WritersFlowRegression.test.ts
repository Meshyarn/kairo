import { describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SmartContextServer } from '../../index.js';
import { NativeModuleLoader } from "../../orchestration/capabilities/NativeModuleLoader.js";
import { NativeSearchCoreStub } from "../utils/NativeSearchCoreStub.js";

const runJsonTool = async (server: SmartContextServer, toolName: string, args: any) => {
  const response = await (server as any).handleCallTool(toolName, args);
  expect(response).toBeDefined();
  expect(response.isError).not.toBe(true);
  return JSON.parse(response.content[0].text);
};

describe('Writers flow - legacy behavior regression', () => {
  let server: SmartContextServer;
  let testRoot: string;
  const originalMode = process.env.KAIRO_MODE;

  beforeEach(async () => {
    process.env.KAIRO_MODE = "dev";
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
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-writers-regression-'));
    fs.mkdirSync(path.join(testRoot, 'src'), { recursive: true });
    server = new SmartContextServer(testRoot);
    await server.waitForInitialScan();
  });

  afterEach(async () => {
    await server.shutdown();
    fs.rmSync(testRoot, { recursive: true, force: true });
    NativeModuleLoader.resetForTesting();
    if (originalMode === undefined) {
      delete process.env.KAIRO_MODE;
    } else {
      process.env.KAIRO_MODE = originalMode;
    }
  });

  it('writes explicit content without requiring a session', async () => {
    const relPath = path.join('src', 'legacy.ts');
    const content = 'export const legacy = true;\n';

    const result = await runJsonTool(server, 'write', {
      intent: 'Create legacy file',
      targetPath: relPath,
      content,
      dryRun: false
    });

    expect(result.success).toBe(true);
    const saved = fs.readFileSync(path.join(testRoot, relPath), 'utf-8');
    expect(saved).toBe(content);
  });
});
