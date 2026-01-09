import { describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SmartContextServer } from '../../index.js';

const runTool = async (server: SmartContextServer, toolName: string, args: any) => {
  const response = await (server as any).handleCallTool(toolName, args);
  expect(response).toBeDefined();
  if (response.isError) return response;
  const payload = JSON.parse(response.content[0].text);
  return payload;
};

describe('EditHandlers', () => {
  let server: SmartContextServer;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-handler-test-'));
    fs.mkdirSync(path.join(testRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(testRoot, 'src', 'file.ts'), 'original content');
    
    server = new SmartContextServer(testRoot);
  });

  afterEach(async () => {
    await server.shutdown();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('handles edit_apply tool with single file', async () => {
    const relPath = path.join('src', 'file.ts');
    const result = await runTool(server, 'edit_apply', {
      edits: [{
        filePath: relPath,
        targetString: 'original content',
        replacementString: 'new content'
      }],
      dryRun: false
    });

    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(testRoot, relPath), 'utf-8')).toBe('new content');
  });

  it('handles edit_transaction tool via orchestration', async () => {
    const relPath = path.join('src', 'file.ts');
    const result = await runTool(server, 'edit_transaction', {
      filePath: relPath,
      edits: [{
        targetString: 'original content',
        replacementString: 'coordinated content'
      }],
      dryRun: false
    });

    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(testRoot, relPath), 'utf-8')).toBe('coordinated content');
  });
});
