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

  if (response.content?.[0]?.text) {
      try {
          return JSON.parse(response.content[0].text);
      } catch {}
  }

  if (response.isError) {
      return response;
  }
  const payload = JSON.parse(response.content[0].text);
  return payload;
};

jest.setTimeout(60000);

describe('ExplorePillar Integration', () => {
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
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-test-'));
    fs.mkdirSync(path.join(testRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'docs'), { recursive: true });
    
    const mainContent = 'export function main() { console.log(\"hello\"); }';
    const helperContent = 'export const helper = () => \"hello\";';
    fs.writeFileSync(path.join(testRoot, 'src', 'main.ts'), mainContent);
    fs.writeFileSync(path.join(testRoot, 'src', 'helper.ts'), helperContent);
    fs.writeFileSync(path.join(testRoot, 'docs', 'readme.md'), '# Documentation\nThis is a readme file.');
    fs.writeFileSync(path.join(testRoot, 'docs', 'guide.md'), '# Guide\nhello from docs.');
    
    server = new SmartContextServer(testRoot);
    await server.waitForInitialScan();
    const documentIndexer = (server as any).documentIndexer;
    const nativeSearchIndexer = (server as any).nativeSearchIndexer;
    const repoId = (server as any).repoRegistry?.getDefaultRepo?.()?.id ?? "default";
    if (documentIndexer?.indexFile) {
      await documentIndexer.indexFile("docs/readme.md");
      await documentIndexer.indexFile("docs/guide.md");
      nativeSearchIndexer?.flush?.();
    }
    if (nativeSearchIndexer?.upsertCodeFile) {
      nativeSearchIndexer.upsertCodeFile({
        repoId,
        filePath: "src/main.ts",
        content: mainContent,
        mtimeMs: Date.now()
      });
      nativeSearchIndexer.upsertCodeFile({
        repoId,
        filePath: "src/helper.ts",
        content: helperContent,
        mtimeMs: Date.now()
      });
      nativeSearchIndexer.flush?.();
    }
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

  it('performs query-based exploration across docs and code', async () => {
    const result = await runTool(server, 'explore', {
      query: 'hello',
      include: { docs: true, code: true }
    });

    expect(result.success).toBe(true);
    expect(result.data.docs.length).toBeGreaterThan(0);
    expect(result.data.code.length).toBeGreaterThan(0);
    expect(result.pack).toBeDefined();
  });

  it('expands specific paths with full view', async () => {
    const relPath = path.join('src', 'main.ts');
    const result = await runTool(server, 'explore', {
      paths: [relPath],
      view: 'full'
    });

    expect(result.success).toBe(true);
    expect(result.data.code[0].kind).toBe('file_full');
    expect(result.data.code[0].content).toContain('export function main()');
  });

  it('supports pagination via cursors', async () => {
    // 1. Initial search to get packId
    const firstResult = await runTool(server, 'explore', {
      query: 'hello',
      limits: { maxResults: 1 }
    });

    expect(firstResult.success).toBe(true);
    expect(firstResult.next?.itemsCursor).toBeDefined();
    const packId = firstResult.pack.packId;

    // 2. Use cursor to get next page
    const secondResult = await runTool(server, 'explore', {
      query: 'hello',
      packId,
      cursor: { items: firstResult.next.itemsCursor }
    });

    expect(secondResult.success).toBe(true);
    expect(secondResult.pack.hit).toBe(true);
  });

  it('respects sources=docs and emits trace', async () => {
    const result = await runTool(server, 'explore', {
      query: 'How to Improve Session UX?',
      sources: 'docs',
      trace: true
    });

    expect(result.success).toBe(true);
    expect(result.effectiveOptions?.version).toBe(1);
    expect(result.effectiveOptions?.pillar).toBe('explore');
    expect(result.effectiveOptions?.sources).toBe('docs');
    expect(result.decisionTrace?.version).toBe(1);
    expect(result.decisionTrace?.pillar).toBe('explore');
    expect(result.decisionTrace?.optionResolution?.sources?.resolved).toBe('docs');

    const allowlist = new Set([
      "allocator.plan_created",
      "allocator.section_strategy",
      "allocator.section_omit",
      "allocator.reuse_pack",
      "allocator.reuse_summary"
    ]);
    const allocatorCodes = (result.decisionTrace?.events ?? [])
      .map((event: any) => event?.code)
      .filter((code: any) => typeof code === "string" && code.startsWith("allocator."));
    expect(allocatorCodes.every((code: string) => allowlist.has(code))).toBe(true);

    const adaptiveFlowAllowlist = new Set([
      "adaptive_flow.gate.profile",
      "adaptive_flow.gate.scale",
      "adaptive_flow.rollout.user_missing",
      "adaptive_flow.shadow.noop"
    ]);
    const adaptiveFlowCodes = (result.decisionTrace?.events ?? [])
      .map((event: any) => event?.code)
      .filter((code: any) => typeof code === "string" && code.startsWith("adaptive_flow."));
    expect(adaptiveFlowCodes.every((code: string) => adaptiveFlowAllowlist.has(code))).toBe(true);
  });

  it('blocks sensitive files by default', async () => {
    fs.writeFileSync(path.join(testRoot, '.env'), 'SECRET_KEY=12345');
    
    const result = await runTool(server, 'explore', {
      paths: ['.env'],
      view: 'full'
    });

    expect(result.status).toBe('blocked');
    expect(result.message).toContain('blocked');
  });
});
