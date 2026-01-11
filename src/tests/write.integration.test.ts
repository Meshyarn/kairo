import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SmartContextServer } from '../index.js';

const runTool = async (server: SmartContextServer, toolName: string, args: any) => {
  const response = await (server as any).handleCallTool(toolName, args);
  expect(response).toBeDefined();
  const payload = JSON.parse(response.content[0].text);
  return payload;
};

jest.setTimeout(30000);

describe('SmartContextServer - write integration', () => {
  let server: SmartContextServer;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'write-test-'));
    fs.mkdirSync(path.join(testRoot, 'src'), { recursive: true });
    server = new SmartContextServer(testRoot);
  });

  afterEach(async () => {
    await server.shutdown();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('returns a draft when safety=plan is set', async () => {
    const result = await runTool(server, 'write', {
      intent: 'Create a demo file',
      targetPath: 'src/demo.ts',
      content: 'export const demo = true;',
      safety: 'plan',
      trace: true
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('draft');
    expect(result.effectiveOptions?.safety).toBe('plan');
    expect(result.decisionTrace?.dryRun?.resolved).toBe(true);
  });
});
