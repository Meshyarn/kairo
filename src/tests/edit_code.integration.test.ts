import { describe, beforeEach, afterEach, it, expect } from '@jest/globals';
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

describe('SmartContextServer - edit_apply integration', () => {
    let server: SmartContextServer;
    let testRoot: string;

    beforeEach(async () => {
        testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-code-test-'));
        fs.mkdirSync(path.join(testRoot, 'src'), { recursive: true });
        server = new SmartContextServer(testRoot);
    });

    afterEach(async () => {
        await server.shutdown();
        fs.rmSync(testRoot, { recursive: true, force: true });
    });

    it('replays escaped replacements end-to-end', async () => {
        const relPath = path.join('src', 'escaped.ts');
        const absPath = path.join(testRoot, relPath);
        fs.writeFileSync(absPath, 'const label = "before";\n', 'utf-8');

        const result = await runTool(server, 'edit_apply', {
            edits: [{
                filePath: relPath,
                operation: 'replace',
                targetString: 'const label = "before";',
                replacementString: 'const label = "after";'
            }]
        });

        expect(result.success).toBe(true);
        const updated = fs.readFileSync(absPath, 'utf-8');
        expect(updated).toContain('const label = "after";');
    });

    it('handles CRLF content and undo via project_manage', async () => {
        const relFirst = path.join('src', 'windows.ts');
        const relSecond = path.join('src', 'second.ts');
        const absFirst = path.join(testRoot, relFirst);
        const absSecond = path.join(testRoot, relSecond);

        fs.writeFileSync(absFirst, 'const alpha = "beta";\r\n', 'utf-8');
        fs.writeFileSync(absSecond, 'const first = "line";\nconst second = "line";\n', 'utf-8');

        const editResult = await runTool(server, 'edit_apply', {
            edits: [
                {
                    filePath: relFirst,
                    operation: 'replace',
                    targetString: 'const alpha = "beta";',
                    replacementString: 'const alpha = "BETA";'
                },
                {
                    filePath: relSecond,
                    operation: 'replace',
                    targetString: 'const second = "line";',
                    replacementString: 'const second = "patched";'
                }
            ]
        });
        expect(editResult.success).toBe(true);
        const windowsContent = fs.readFileSync(absFirst, 'utf-8');
        expect(windowsContent).toContain('const alpha = "BETA";');
        
        const undoResult = await runTool(server, 'project_manage', { command: 'undo' });
        expect(undoResult.output).toMatch(/undid/i);
        expect(fs.readFileSync(absFirst, 'utf-8')).toBe('const alpha = "beta";\r\n');
        expect(fs.readFileSync(absSecond, 'utf-8')).toBe('const first = "line";\nconst second = "line";\n');
    });

    it('decodes structural newline escapes in multi-line replacements', async () => {
        const relPath = path.join('src', 'structural.ts');
        const absPath = path.join(testRoot, relPath);
        fs.writeFileSync(absPath, 'const alpha = 1;\n', 'utf-8');

        const result = await runTool(server, 'edit_apply', {
            edits: [{
                filePath: relPath,
                operation: 'replace',
                targetString: 'const alpha = 1;',
                replacementString: 'const alpha = 1;\nconst beta = 2;\n'
            }]
        });

        expect(result.success).toBe(true);
        const updated = fs.readFileSync(absPath, 'utf-8');
        expect(updated).toContain('const alpha = 1;\nconst beta = 2;');
    });

    it('surfacing actionable errors for ambiguous matches', async () => {
        const relPath = path.join('src', 'ambiguous.ts');
        const absPath = path.join(testRoot, relPath);
        fs.writeFileSync(absPath, 'const a = "repeat";\nconst b = "repeat";\n', 'utf-8');

        const result = await runTool(server, 'edit_apply', {
            edits: [{
                filePath: relPath,
                operation: 'replace',
                targetString: 'const a = "repeat";', // Not ambiguous anymore, let's fix to be truly ambiguous
                replacementString: 'const a = "patched";'
            }]
        });
        
        // To make it ambiguous again:
        fs.writeFileSync(absPath, 'const val = "repeat";\nconst val = "repeat";\n', 'utf-8');
        const ambResult = await runTool(server, 'edit_apply', {
            edits: [{
                filePath: relPath,
                operation: 'replace',
                targetString: 'const val = "repeat";',
                replacementString: 'const val = "patched";'
            }]
        });

        expect(ambResult.success).toBe(false);
        expect(ambResult.results?.[0]?.error).toMatch(/Ambiguous match/i);
    });
});
