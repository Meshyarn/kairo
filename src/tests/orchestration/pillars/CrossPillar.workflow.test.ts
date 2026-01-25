import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SmartContextServer } from '../../../index.js';
import { NativeModuleLoader } from "../../../orchestration/capabilities/NativeModuleLoader.js";
import { NativeSearchCoreStub } from "../../utils/NativeSearchCoreStub.js";

const runTool = async (server: SmartContextServer, toolName: string, args: any) => {
  const response = await (server as any).handleCallTool(toolName, args);
  expect(response).toBeDefined();
  if (response.isError) return response;
  const payload = JSON.parse(response.content[0].text);
  return payload;
};

jest.setTimeout(30000);

describe('Cross-Pillar Workflow Integration', () => {
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
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-test-'));
    fs.mkdirSync(path.join(testRoot, 'src'), { recursive: true });
    
    fs.writeFileSync(path.join(testRoot, 'src', 'app.ts'), 'export class App { run() { return \"start\"; } }');
    
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

  it('executes a typical agent loop: Explore -> Understand -> Change -> Verify', async () => {
    // 1. Explore: Find files related to app
    const relPath = path.join('src', 'app.ts');
    const exploreResult = await runTool(server, 'explore', {
      paths: [relPath],
      view: 'preview',
      include: { code: true, docs: false }
    });
    expect(exploreResult.success).toBe(true);
    const appPath = exploreResult.data.code[0].filePath;
    expect(appPath).toContain('app.ts');

    // 2. Understand: Get deep analysis of the file
    const understandResult = await runTool(server, 'understand', {
      goal: appPath,
      target: appPath,
      depth: 'standard',
      include: { callGraph: true, dependencies: true }
    });
    const structure = understandResult.structure ?? understandResult.skeleton;
    expect(structure).toBeDefined();
    expect(understandResult.report.complexity).toBeDefined();

    // 3. Change: Modify the implementation
    const changeResult = await runTool(server, 'change', {
      intent: 'Make App.run return \"running\"',
      targetFiles: [appPath],
      edits: [{
        targetString: 'return \"start\";',
        replacementString: 'return \"running\";'
      }],
      options: { dryRun: false }
    });
    expect(changeResult.success).toBe(true);

    // 4. Verify: Check the file content (via Explore view=full)
    const verifyResult = await runTool(server, 'explore', {
      paths: [appPath],
      view: 'full'
    });
    expect(verifyResult.data.code[0].content).toContain('return \"running\";');
  });
});
