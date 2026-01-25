
import { jest, describe, beforeAll, afterAll, beforeEach, it, expect } from '@jest/globals';
import { SmartContextServer } from "../index.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FileSearchResult } from "../types.js";

describe('SmartContextServer - file_scout', () => {
    let server: SmartContextServer;
    let tempRootDir: string;
    let testFilesDir: string;
    const rankingKeyword = 'rankingToken';
    const tieBreakerKeyword = 'keywordToken';
    let basePath: string;
    const originalEnv = {
        storageMode: process.env.KAIRO_STORAGE_MODE,
        baselineEnabled: process.env.KAIRO_BASELINE_ENABLED
    };

    // Increase timeout for all tests in this suite
    jest.setTimeout(30000);

    beforeAll(async () => {
        process.env.KAIRO_STORAGE_MODE = "memory";
        process.env.KAIRO_BASELINE_ENABLED = "on";

        tempRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-file-scout-"));
        testFilesDir = path.join(tempRootDir, "test_files", "file_scout");
        basePath = testFilesDir;

        if (!fs.existsSync(testFilesDir)) {
            fs.mkdirSync(testFilesDir, { recursive: true });
        }

        fs.writeFileSync(path.join(testFilesDir, 'file1.txt'), 'This is a test file.\nIt contains keyword1 and keyword2.\nAnother line here.');
        fs.writeFileSync(path.join(testFilesDir, 'file2.ts'), '// TypeScript file\nconst data = "pattern1";\nfunction testFunc() { /* ... */ }\nconst another = "pattern2";');
        fs.writeFileSync(path.join(testFilesDir, 'file3.js'), 'console.log("keyword1");\nvar x = 1;');
        fs.writeFileSync(path.join(testFilesDir, 'empty.txt'), '');
        fs.writeFileSync(path.join(testFilesDir, 'ranking1.txt'), `${rankingKeyword} ${rankingKeyword} ${rankingKeyword} ${tieBreakerKeyword}`);
        fs.writeFileSync(path.join(testFilesDir, 'ranking2.txt'), `${rankingKeyword} ${tieBreakerKeyword}`);
        fs.writeFileSync(path.join(testFilesDir, 'ranking3.txt'), `another ${tieBreakerKeyword}`);
        fs.writeFileSync(path.join(testFilesDir, 'User.ts'), 'export const User = { name: "User" };\n');
        fs.writeFileSync(path.join(testFilesDir, 'UserManager.ts'), 'export class UserManager {\n    constructor() {\n        console.log("UserManager ready");\n    }\n}\n');

        server = new SmartContextServer(tempRootDir);
        await (server as any).incrementalIndexer?.start?.();
        await server.waitForInitialScan();
        await (server as any).documentIndexer?.rebuildAll?.();

        const nativeStatus = (server as any).searchEngine?.getNativeStatus?.();
        expect(nativeStatus?.available).toBe(true);
        expect(nativeStatus?.stats?.docCount ?? 0).toBeGreaterThan(0);
    });

    afterAll(async () => {
        if (server) {
            await server.shutdown();
        }
        if (tempRootDir && fs.existsSync(tempRootDir)) {
            try {
                fs.rmSync(tempRootDir, { recursive: true, force: true });
            } catch (e) {
                // Ignore cleanup errors
            }
        }
        if (originalEnv.storageMode === undefined) {
            delete process.env.KAIRO_STORAGE_MODE;
        } else {
            process.env.KAIRO_STORAGE_MODE = originalEnv.storageMode;
        }
        if (originalEnv.baselineEnabled === undefined) {
            delete process.env.KAIRO_BASELINE_ENABLED;
        } else {
            process.env.KAIRO_BASELINE_ENABLED = originalEnv.baselineEnabled;
        }
    });

    beforeEach(async () => {
        if (server) {
            await server.waitForInitialScan();
        }
    });

    it('should find files with a single keyword', async () => {
        const args = { keywords: ['keyword1'], excludeGlobs: ["node_modules"], basePath };
        const response = await (server as any).handleCallTool('file_search', args);
        expect(response.isError).toBeFalsy();
        const result: FileSearchResult[] = JSON.parse(response.content[0].text);
        expect(result.every(entry => entry.scoreDetails?.type === "native")).toBe(true);
        expect(result).toHaveLength(2);
        expect(result).toEqual(expect.arrayContaining([
            expect.objectContaining({ filePath: 'file1.txt' }),
            expect.objectContaining({ filePath: 'file3.js' }),
        ]));
    });

    it('should find files with a single regex pattern', async () => {
        const args = { patterns: ['pattern[1-2]'], excludeGlobs: ["**/node_modules/**"], basePath };
        const response = await (server as any).handleCallTool('file_search', args);
        expect(response.isError).toBeFalsy();
        const result: FileSearchResult[] = JSON.parse(response.content[0].text);
        expect(result).toHaveLength(2);
        expect(result).toEqual(expect.arrayContaining([
            expect.objectContaining({ filePath: 'file2.ts' }),
        ]));
    });

    it('should find files with multiple keywords/patterns and deduplicate', async () => {
        const args = { keywords: ['keyword2'], patterns: ['pattern1'], excludeGlobs: ["**/node_modules/**"], basePath };
        const response = await (server as any).handleCallTool('file_search', args);
        expect(response.isError).toBeFalsy();
        const result: FileSearchResult[] = JSON.parse(response.content[0].text);
        expect(result).toHaveLength(2);
        expect(result).toEqual(expect.arrayContaining([
            expect.objectContaining({ filePath: 'file1.txt' }),
            expect.objectContaining({ filePath: 'file2.ts' }),
        ]));
    });

    it('should rank files by relevance', async () => {
        const args = { keywords: [rankingKeyword, tieBreakerKeyword], excludeGlobs: ["**/node_modules/**"], basePath };
        const response = await (server as any).handleCallTool('file_search', args);
        expect(response.isError).toBeFalsy();
        const result: FileSearchResult[] = JSON.parse(response.content[0].text);
        expect(result).toHaveLength(3);

        // Expect ranking1.txt to have the highest score, then ranking2.txt, then ranking3.txt
        expect(result[0].filePath).toContain('ranking1.txt');
        expect(result[1].filePath).toContain('ranking2.txt');
        expect(result[2].filePath).toContain('ranking3.txt');

        expect(result[0].score).toBeGreaterThan(result[1].score!);
        expect(result[1].score).toBeGreaterThan(result[2].score!);
        expect(result[0].scoreDetails).toBeDefined();
    });

    it('should match substrings by default and honor word boundary option', async () => {
        const substringArgs = { keywords: ['User'], excludeGlobs: ["**/node_modules/**"], basePath };
        const substringResponse = await (server as any).handleCallTool('file_search', substringArgs);
        expect(substringResponse.isError).toBeFalsy();
        const substringResult: FileSearchResult[] = JSON.parse(substringResponse.content[0].text);

        const exactMatch = substringResult.find(res => res.filePath.endsWith('User.ts'));
        const partialMatch = substringResult.find(res => res.filePath.endsWith('UserManager.ts'));

        expect(exactMatch).toBeDefined();
        expect(partialMatch).toBeDefined();
        expect(exactMatch!.scoreDetails?.filenameMatchType).toBe('exact');
        expect(exactMatch!.scoreDetails?.filenameMultiplier).toBe(10);
        expect(partialMatch!.scoreDetails?.filenameMatchType).toBe('partial');
        expect(partialMatch!.scoreDetails?.filenameMultiplier).toBe(5);

        const boundaryArgs = { keywords: ['User'], wordBoundary: true, excludeGlobs: ["**/node_modules/**"], basePath };
        const boundaryResponse = await (server as any).handleCallTool('file_search', boundaryArgs);
        expect(boundaryResponse.isError).toBeFalsy();
        const boundaryResult: FileSearchResult[] = JSON.parse(boundaryResponse.content[0].text);
        const hasPartial = boundaryResult.some(res => res.filePath.endsWith('UserManager.ts'));
        const hasExact = boundaryResult.some(res => res.filePath.endsWith('User.ts'));
        expect(hasPartial).toBe(false);
        expect(hasExact).toBe(true);
    });
});
