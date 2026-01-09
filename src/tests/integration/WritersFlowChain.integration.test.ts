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

describe('Writers flow - workflow chain integration', () => {
  let server: SmartContextServer;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-writers-flow-'));
    fs.mkdirSync(path.join(testRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(testRoot, 'src', 'greeting.ts'),
      'export const greeting = "hello";\nexport const sayHi = () => greeting;\n',
      'utf-8'
    );

    server = new SmartContextServer(testRoot);
    await server.waitForInitialScan();
  });

  afterEach(async () => {
    await server.shutdown();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('reports high confidence after research + analysis + style pack + dry run', async () => {
    const relPath = path.join('src', 'greeting.ts');

    const explore = await runJsonTool(server, 'explore', {
      paths: [relPath],
      view: 'preview',
      include: { docs: false, code: true },
      research: { sketch: true },
      sessionId: 'new'
    });

    const sessionId = explore.sessionId;
    expect(sessionId).toBeDefined();

    const understand = await runJsonTool(server, 'understand', {
      goal: relPath,
      sessionId,
      vibe: { extract: true, scope: 'src/**/*.ts' },
      analysis: { clusters: true }
    });

    expect(understand.stylePack).toBeDefined();
    expect(understand.analysisPack).toBeDefined();

    const change = await runJsonTool(server, 'change', {
      intent: 'Update greeting',
      targetFiles: [relPath],
      edits: [{ targetString: '"hello"', replacementString: '"hi"' }],
      options: { dryRun: true, includeImpact: false },
      sessionId
    });

    expect(change.success).toBe(true);
    expect(change.workflowMeta?.confidence).toBe('high');
    expect(change.workflowMeta?.workflowStatus).toMatchObject({
      hasResearch: true,
      hasAnalysis: true,
      hasStylePack: true,
      dryRunUsed: true
    });
    expect(change.workflowWarnings ?? []).toHaveLength(0);
  });
});
