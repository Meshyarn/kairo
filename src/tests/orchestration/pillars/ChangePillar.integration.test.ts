import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SmartContextServer } from '../../../index.js';

const runTool = async (server: SmartContextServer, toolName: string, args: any) => {
  const response = await (server as any).handleCallTool(toolName, args);
  expect(response).toBeDefined();
  if (response.isError) return response;
  const payload = JSON.parse(response.content[0].text);
  return payload;
};

jest.setTimeout(30000);

describe('ChangePillar Integration', () => {
  let server: SmartContextServer;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'change-int-test-'));
    fs.mkdirSync(path.join(testRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'docs'), { recursive: true });
    
    fs.writeFileSync(path.join(testRoot, 'src', 'service.ts'), 'export class Service { execute() { return 1; } }');
    fs.writeFileSync(path.join(testRoot, 'src', 'user.ts'), 'import { Service } from \"./service.js\"; const s = new Service(); s.execute();');
    fs.writeFileSync(path.join(testRoot, 'docs', 'api.md'), '# API\nService.execute() returns 1.');
    
    server = new SmartContextServer(testRoot);
    await server.waitForInitialScan();
  });

  afterEach(async () => {
    await server.shutdown();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('provides impact analysis for breaking changes', async () => {
    const relPath = path.join('src', 'service.ts');
    const result = await runTool(server, 'change', {
      intent: 'Rename method to run',
      targetFiles: [relPath],
      edits: [{
        targetString: 'execute()',
        replacementString: 'run()'
      }],
      options: { dryRun: true, includeImpact: true }
    });

    expect(result.success).toBe(true);
    expect(result.impactReport).toBeDefined();
    // Risk should be higher because user.ts depends on execute()
    expect(result.impactReport.breakingChangeRisk).toBeDefined();
  });

  it('supports V2 editor mode for precise symbol matching', async () => {
    // V2 mode is enabled via environment or config
    process.env.KAIRO_EDITOR_V2 = 'true';
    
    const relPath = path.join('src', 'service.ts');
    const plan = await runTool(server, 'change', {
      intent: 'Update return value',
      targetFiles: [relPath],
      edits: [{
        targetString: 'return 1;',
        replacementString: 'return 2;'
      }],
      sessionId: "new",
      options: { dryRun: true }
    });

    expect(plan.success).toBe(true);
    expect(plan.draftPack?.id).toBeDefined();
    expect(plan.applyToken).toBeDefined();

    const result = await runTool(server, 'change', {
      intent: 'Update return value',
      targetFiles: [relPath],
      edits: [{
        targetString: 'return 1;',
        replacementString: 'return 2;'
      }],
      sessionId: plan.sessionId ?? "new",
      draftId: plan.draftPack.id,
      applyToken: plan.applyToken,
      options: { dryRun: false }
    });

    expect(result.success).toBe(true);
    const updated = fs.readFileSync(path.join(testRoot, relPath), 'utf-8');
    expect(updated).toContain('return 2;');
    
    delete process.env.KAIRO_EDITOR_V2;
  });

  it('suggests related documentation updates', async () => {
    const result = await runTool(server, 'change', {
      intent: 'Change return value',
      targetFiles: [path.join('src', 'service.ts')],
      edits: [{
        targetString: 'return 1;',
        replacementString: 'return 2;'
      }],
      sessionId: "new",
      options: { dryRun: true }
    });

    expect(result.success).toBe(true);
    expect(result.draftPack?.id).toBeDefined();
    expect(result.applyToken).toBeDefined();

    const applied = await runTool(server, 'change', {
      intent: 'Change return value',
      targetFiles: [path.join('src', 'service.ts')],
      edits: [{
        targetString: 'return 1;',
        replacementString: 'return 2;'
      }],
      sessionId: result.sessionId ?? "new",
      draftId: result.draftPack.id,
      applyToken: result.applyToken,
      options: { dryRun: false, suggestDocs: true }
    });

    expect(applied.success).toBe(true);
    expect(applied.relatedDocs).toBeDefined();
    expect(applied.relatedDocs.length).toBeGreaterThan(0);
    expect(applied.relatedDocs[0].filePath).toContain('api.md');
  });
});
