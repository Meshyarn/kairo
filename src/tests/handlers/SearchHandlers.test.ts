import { describe, beforeEach, afterEach, it, expect, jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SmartContextServer } from '../../index.js';

jest.setTimeout(20000);

const runTool = async (server: SmartContextServer, toolName: string, args: any) => {
  const response = await (server as any).handleCallTool(toolName, args);
  expect(response).toBeDefined();
  if (response.isError) return response;
  const payload = JSON.parse(response.content[0].text);
  return payload;
};

describe('SearchHandlers', () => {
  let server: SmartContextServer;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'search-handler-test-'));
    fs.mkdirSync(path.join(testRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(testRoot, 'src', 'data.ts'), 'export const DATA = 1;');
    
    server = new SmartContextServer(testRoot);
  });

  afterEach(async () => {
    await server.shutdown();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('handles project_search tool correctly', async () => {
    const result = await runTool(server, 'project_search', {
      query: 'DATA',
      type: 'symbol'
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].path).toContain('data.ts');
  });

  it('handles file_scout tool correctly', async () => {
    const result = await runTool(server, 'file_scout', {
      query: 'DATA'
    });

    expect(result.success).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('excludes .kairo entries from filename search results', async () => {
    const smartContextDir = path.join(testRoot, '.kairo', 'data');
    fs.mkdirSync(smartContextDir, { recursive: true });
    fs.writeFileSync(path.join(smartContextDir, 'OrchestrationEngine.ts'), 'export const BACKUP = true;');
    fs.writeFileSync(path.join(testRoot, 'src', 'OrchestrationEngine.ts'), 'export const REAL = true;');

    const result = await runTool(server, 'project_search', {
      query: 'OrchestrationEngine',
      type: 'filename'
    });

    const paths = result.results.map((entry: { path: string }) => entry.path.replace(/\\/g, '/'));
    expect(paths.some((entry: string) => entry.includes('/.kairo/'))).toBe(false);
    expect(paths.some((entry: string) => entry.endsWith('src/OrchestrationEngine.ts'))).toBe(true);
  });

  it('adds repo metadata and filters by repoScope', async () => {
    await server.shutdown();
    const repoA = path.join(testRoot, 'repo-a');
    const repoB = path.join(testRoot, 'repo-b');
    fs.mkdirSync(path.join(repoA, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repoB, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoA, 'src', 'data.ts'), 'export const DATA = 1;');
    fs.writeFileSync(path.join(repoB, 'src', 'data.ts'), 'export const DATA = 2;');
    const configDir = path.join(testRoot, '.kairo', 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'mcp-config.json'), JSON.stringify({
      version: "1.0",
      repositories: {
        a: { path: "repo-a", name: "Repo A", type: "primary", languages: ["typescript"] },
        b: { path: "repo-b", name: "Repo B", type: "linked", languages: ["typescript"] }
      },
      defaultRepo: "a"
    }, null, 2));
    server = new SmartContextServer(testRoot);

    const allResults = await runTool(server, 'project_search', {
      query: 'data.ts',
      type: 'filename'
    });
    expect(allResults.results.length).toBeGreaterThan(0);
    expect(allResults.results.every((entry: any) => !path.isAbsolute(entry.path))).toBe(true);
    expect(allResults.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ repoId: 'a', repoRelativePath: 'src/data.ts' }),
      expect.objectContaining({ repoId: 'b', repoRelativePath: 'src/data.ts' })
    ]));

    const scoped = await runTool(server, 'project_search', {
      query: 'data.ts',
      type: 'filename',
      repoScope: { mode: 'repos', repoIds: ['b'] }
    });
    expect(scoped.results).toHaveLength(1);
    expect(scoped.results[0]).toMatchObject({ repoId: 'b', repoRelativePath: 'src/data.ts' });
  });
});
