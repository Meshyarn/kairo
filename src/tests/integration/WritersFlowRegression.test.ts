import { describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SmartContextServer } from '../../index.js';

const runJsonTool = async (server: SmartContextServer, toolName: string, args: any) => {
  const response = await (server as any).handleCallTool(toolName, args);
  expect(response).toBeDefined();
  expect(response.isError).not.toBe(true);
  return JSON.parse(response.content[0].text);
};

describe('Writers flow - legacy behavior regression', () => {
  let server: SmartContextServer;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-writers-regression-'));
    fs.mkdirSync(path.join(testRoot, 'src'), { recursive: true });
    server = new SmartContextServer(testRoot);
    await server.waitForInitialScan();
  });

  afterEach(async () => {
    await server.shutdown();
    fs.rmSync(testRoot, { recursive: true, force: true });
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
