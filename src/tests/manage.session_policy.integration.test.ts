import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SmartContextServer } from '../index.js';
import { FeatureFlags } from '../config/FeatureFlags.js';

const runTool = async (server: SmartContextServer, toolName: string, args: any) => {
  const response = await (server as any).handleCallTool(toolName, args);
  expect(response).toBeDefined();
  const payload = JSON.parse(response.content[0].text);
  return payload;
};

jest.setTimeout(30000);

describe('SmartContextServer - session policy integration', () => {
  let server: SmartContextServer;
  let testRoot: string;
  beforeEach(async () => {
    FeatureFlags.initialize();
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'session-policy-test-'));
    fs.mkdirSync(path.join(testRoot, 'src'), { recursive: true });
    server = new SmartContextServer(testRoot);
  });

  afterEach(async () => {
    await server.shutdown();
    fs.rmSync(testRoot, { recursive: true, force: true });
    FeatureFlags.initialize();
  });

  it('stores and retrieves session policy via manage', async () => {
    const explore = await runTool(server, 'explore', {
      query: 'session policy seed',
      sessionId: 'new'
    });

    expect(explore.sessionId).toBeDefined();
    const sessionId = explore.sessionId as string;

    const updated = await runTool(server, 'manage', {
      command: 'session_update',
      sessionId,
      policy: { profile: 'deep', sources: 'docs', safety: 'plan', write: { safety: 'plan' } },
      policyMode: 'merge'
    });

    expect(updated.success).toBe(true);

    const fetched = await runTool(server, 'manage', {
      command: 'session',
      sessionId
    });

    expect(fetched.success).toBe(true);
    expect(fetched.result?.session?.policy?.profile).toBe('deep');
    expect(fetched.result?.session?.policy?.sources).toBe('docs');
    expect(fetched.result?.session?.policy?.safety).toBe('plan');
    expect(fetched.result?.session?.policy?.write?.safety).toBe('plan');

    const writeResult = await runTool(server, 'write', {
      intent: 'Create file with policy',
      targetPath: 'src/policy.ts',
      content: 'export const policy = true;',
      sessionId,
      trace: true
    });

    expect(writeResult.success).toBe(true);
    expect(writeResult.effectiveOptions?.safety).toBe('plan');
    expect(writeResult.decisionTrace?.dryRun?.resolved).toBe(true);
  });
});
