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

const extractText = (response: any): string => {
    if (response?.content?.[0]?.text) {
        return response.content[0].text;
    }
    if (typeof response?.content === 'string') {
        return response.content;
    }
    throw new Error(`Invalid response content: ${JSON.stringify(response)}`);
};

describe('End-to-end workflows', () => {
    let server: SmartContextServer;
    let testRoot: string;
    const originalMode = process.env.KAIRO_MODE;

    beforeEach(async () => {
        process.env.KAIRO_MODE = "dev";
        testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-e2e-'));
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
        if (originalMode === undefined) {
            delete process.env.KAIRO_MODE;
        } else {
            process.env.KAIRO_MODE = originalMode;
        }
    });

    it('explore → code_read → change 흐름이 정상 동작한다', async () => {
        const relPath = path.join('src', 'greeting.ts');

        const explore = await runJsonTool(server, 'explore', {
            paths: [relPath],
            view: 'preview',
            include: { docs: false, code: true },
            limits: { maxResults: 2 }
        });

        expect(explore.success).toBe(true);
        expect(explore.data.code.length).toBeGreaterThan(0);
        expect(explore.data.code[0].filePath).toContain(relPath.replace(/\\/g, '/'));

        const readResponse = await (server as any).handleCallTool('code_read', { filePath: relPath, view: 'full' });
        const readText = extractText(readResponse);
        expect(readText).toContain('greeting');

        const change = await runJsonTool(server, 'change', {
            intent: 'Update greeting',
            targetFiles: [relPath],
            edits: [{ targetString: '"hello"', replacementString: '"hi"' }],
            options: { dryRun: false, includeImpact: false }
        });

        expect(change.success).toBe(true);
        const updated = fs.readFileSync(path.join(testRoot, relPath), 'utf-8');
        expect(updated).toContain('"hi"');
    });

    it('세션 아티팩트 없이도 change가 경고를 제공하며 계획을 반환한다', async () => {
        const relPath = path.join('src', 'greeting.ts');

        const change = await runJsonTool(server, 'change', {
            intent: 'Update greeting',
            targetFiles: [relPath],
            edits: [{ targetString: '"hello"', replacementString: '"hey"' }],
            options: { dryRun: true, includeImpact: false },
            sessionId: 'new'
        });

        expect(change.success).toBe(true);
        expect(change.workflowWarnings).toEqual(expect.arrayContaining([
            'No StylePack found in session. Consider running understand({ vibe: { extract: true } }).',
            'No AnalysisPack found in session. Consider running understand({ analysis: { clusters: true } }).',
            'No ResearchPack found in session. Consider running explore({ research: { sketch: true } }).'
        ]));
    });
});
