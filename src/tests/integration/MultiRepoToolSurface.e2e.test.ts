import { describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SmartContextServer } from '../../index.js';

const runJsonTool = async (server: SmartContextServer, toolName: string, args: any) => {
  const response = await (server as any).handleCallTool(toolName, args);
  expect(response).toBeDefined();

  // Try parsing JSON first, even if isError is true, as structured errors are common
  if (response.content?.[0]?.text) {
      try {
          return JSON.parse(response.content[0].text);
      } catch {
          // Fall through if not JSON
      }
  }

  if (response.isError) {
    throw new Error(response.content?.[0]?.text ?? "Tool error");
  }
  return JSON.parse(response.content[0].text);
};

describe('Multi-repo tool surface', () => {
  let server: SmartContextServer;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-multi-repo-'));
    const repoA = path.join(testRoot, 'repo-a');
    const repoB = path.join(testRoot, 'repo-b');
    fs.mkdirSync(path.join(repoA, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repoB, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoA, 'src', 'alpha.ts'), 'export const ALPHA = true;\n');
    fs.writeFileSync(path.join(repoB, 'src', 'beta.ts'), 'export const BETA = true;\n');

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
    await server.waitForInitialScan();
  });

  afterEach(async () => {
    await server.shutdown();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('returns repo metadata in project_search results', async () => {
    const result = await runJsonTool(server, 'project_search', {
      query: 'alpha.ts',
      type: 'filename'
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]).toMatchObject({
      repoId: 'a',
      repoRelativePath: 'src/alpha.ts'
    });
    expect(path.isAbsolute(result.results[0].path)).toBe(false);
  });

  it('blocks cross-repo change by default', async () => {
    const change = await runJsonTool(server, 'change', {
      intent: 'Update both files',
      targetFiles: ['repo-a/src/alpha.ts', 'repo-b/src/beta.ts'],
      edits: [
        { filePath: 'repo-a/src/alpha.ts', targetString: 'true', replacementString: 'false' },
        { filePath: 'repo-b/src/beta.ts', targetString: 'true', replacementString: 'false' }
      ],
      options: { dryRun: true }
    });

    expect(change.success).toBe(false);
    expect(change.status).toBe('blocked');
    expect(change.blockedReason).toBe('cross_repo_edit_blocked');
    expect(change.errorCode).toBe('CROSS_REPO_EDIT_BLOCKED');
  });

  it('blocks write outside default repo scope', async () => {
    const result = await runJsonTool(server, 'write', {
      intent: 'Create file',
      targetPath: 'repo-b/src/new.ts',
      content: 'export const NEW = true;\n',
      dryRun: true
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('blocked');
    expect(result.blockedReason).toBe('cross_repo_scope_mismatch');
    expect(result.errorCode).toBe('CROSS_REPO_SCOPE_MISMATCH');
  });
});
