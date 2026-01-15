import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SmartContextServer } from '../../../index.js';

const runTool = async (server: SmartContextServer, toolName: string, args: any) => {
  const response = await (server as any).handleCallTool(toolName, args);
  expect(response).toBeDefined();
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

  beforeEach(async () => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-test-'));
    fs.mkdirSync(path.join(testRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'docs'), { recursive: true });
    
    fs.writeFileSync(path.join(testRoot, 'src', 'main.ts'), 'export function main() { console.log(\"hello\"); }');
    fs.writeFileSync(path.join(testRoot, 'src', 'helper.ts'), 'export const helper = () => \"hello\";');
    fs.writeFileSync(path.join(testRoot, 'docs', 'readme.md'), '# Documentation\nThis is a readme file.');
    fs.writeFileSync(path.join(testRoot, 'docs', 'guide.md'), '# Guide\nhello from docs.');
    
    server = new SmartContextServer(testRoot);
  });

  afterEach(async () => {
    await server.shutdown();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('performs query-based exploration across docs and code', async () => {
    const result = await runTool(server, 'explore', {
      query: 'main function documentation',
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
