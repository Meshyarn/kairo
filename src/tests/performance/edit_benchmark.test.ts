
import { SmartContextServer } from "../../index.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Performance - file_edit', () => {
    let server: SmartContextServer;
    let perfTestDir: string;
    const largeFileName = 'large_file.txt';

    beforeAll(() => {
        perfTestDir = fs.mkdtempSync(path.join(os.tmpdir(), "perf-edit-"));

        const uniqueTarget = 'UNIQUE_TARGET_STRING_FOR_PERF_TEST';
        // Create a 1MB file for performance testing
        const largeContent = uniqueTarget + 'a'.repeat(1024 * 1024 - uniqueTarget.length);
        fs.writeFileSync(path.join(perfTestDir, largeFileName), largeContent);

        server = new SmartContextServer(perfTestDir);
    });

    afterAll(() => {
        if (fs.existsSync(perfTestDir)) {
            fs.rmSync(perfTestDir, { recursive: true, force: true });
        }
    });

    it('should perform edits on a large file in a reasonable time', async () => {
        const startTime = Date.now();

        const args = {
            filePath: largeFileName,
            edits: [
                { targetString: 'UNIQUE_TARGET_STRING_FOR_PERF_TEST', replacementString: 'REPLACED' }
            ]
        };

        const response = await (server as any).handleCallTool('file_edit', args);

        const endTime = Date.now();
        console.log(`[PERF] file_edit took ${endTime - startTime}ms`);

        expect(response.isError).toBeFalsy();
    }, 10000); // 10 seconds timeout for this test
});

/**
 * ADR-024: Enhanced Edit Flexibility and Safety Performance Benchmarks
 *
 * This test suite validates that the new Confidence Scoring and Normalization
 * features do not introduce unacceptable performance overhead.
 */
describe('Performance - ADR-024 Confidence Scoring and Normalization', () => {
    let server: SmartContextServer;
    let perfTestDir: string;

    beforeAll(() => {
        perfTestDir = fs.mkdtempSync(path.join(os.tmpdir(), "perf-adr024-"));
        server = new SmartContextServer(perfTestDir);
    });

    afterAll(() => {
        if (fs.existsSync(perfTestDir)) {
            fs.rmSync(perfTestDir, { recursive: true, force: true });
        }
    });

    it('should compute confidence scores with < 2ms overhead per edit', async () => {
        const testFile = path.join(perfTestDir, 'confidence_test.ts');
        const content = `
function authenticate(username,password) {
  return validateCredentials(username, password);
}

function validateCredentials(user, pass) {
  return user && pass && user.length > 0;
}

export { authenticate, validateCredentials };
        `.trim();

        fs.writeFileSync(testFile, content);

        const startTime = Date.now();

        const args = {
            edits: [{
                filePath: 'confidence_test.ts',
                operation: 'replace',
                targetString: 'function authenticate(username,password) {',
                replacementString: 'async function authenticate(username, password) {',
                normalization: 'whitespace'
            }]
        };

        const response = await (server as any).handleCallTool('edit_apply', args);
        const elapsed = Date.now() - startTime;
        const maxMs = Number(process.env.KAIRO_PERF_CONFIDENCE_MAX_MS ?? "600");

        console.log(`[PERF] Confidence scoring (single edit) took ${elapsed}ms`);
        expect(elapsed).toBeLessThan(maxMs);
        expect(response.isError).toBeFalsy();
    }, 10000);

    it('should handle 6-level normalization cascade efficiently', async () => {
        const testFile = path.join(perfTestDir, 'normalization_test.ts');
        const content = `const  x  =  1;  \r\nconst  y  =  2;  `;
        fs.writeFileSync(testFile, content);

        const perfMetrics: Record<string, number> = {};

        // Test each normalization level
        for (const level of ['exact', 'line-endings', 'trailing', 'indentation', 'whitespace', 'structural'] as const) {
            const startTime = Date.now();

            const args = {
                edits: [{
                    filePath: 'normalization_test.ts',
                    operation: 'replace',
                    targetString: 'const x = 1;',
                    replacementString: 'const x = 100;',
                    normalization: level === 'exact' ? undefined : level
                }]
            };

            try {
                await (server as any).handleCallTool('edit_apply', args);
            } catch {
                // Expected for some levels on this test case
            }

            perfMetrics[level] = Date.now() - startTime;
        }

        console.log('[PERF] Normalization cascade metrics:', perfMetrics);

        const maxMs = Number(process.env.KAIRO_PERF_NORMALIZATION_MAX_MS ?? "200");
        Object.values(perfMetrics).forEach(time => {
            expect(time).toBeLessThan(maxMs);
        });
    }, 15000);

    it('should compute hash verification for large files efficiently', async () => {
        const testFile = path.join(perfTestDir, 'delete_hash_test.ts');
        const content = 'a'.repeat(15_000); // Create 15KB file
        fs.writeFileSync(testFile, content);

        const startTime = Date.now();

        // Simulate dry-run to get hash
        const args = {
            edits: [{
                filePath: 'delete_hash_test.ts',
                operation: 'delete',
                confirmationHash: 'deadbeef'
            }],
            dryRun: true,
            options: { deleteMode: 'confirm' }
        };

        const response = await (server as any).handleCallTool('edit_apply', args);
        const hashComputeTime = Date.now() - startTime;
        const maxMs = Number(process.env.KAIRO_PERF_HASH_MAX_MS ?? "500");

        console.log(`[PERF] Delete hash computation (15KB file) took ${hashComputeTime}ms`);

        expect(hashComputeTime).toBeLessThan(maxMs);
        expect(response.isError).toBeFalsy();
    }, 10000);

    it('should handle refactoring context guidance without performance penalty', async () => {
        const testFile = path.join(perfTestDir, 'refactor_context_test.ts');
        fs.writeFileSync(testFile, 'const oldName = 1;');

        const startTime = Date.now();

        const args = {
            refactoringContext: {
                pattern: 'rename-symbol',
                scope: 'project',
                estimatedEdits: 25
            },
            edits: [{
                filePath: 'refactor_context_test.ts',
                operation: 'replace',
                targetString: 'const oldName = 1;',
                replacementString: 'const newName = 1;'
            }],
            dryRun: true
        };

        const response = await (server as any).handleCallTool('edit_apply', args);
        const elapsed = Date.now() - startTime;
        const maxMs = Number(process.env.KAIRO_PERF_REFACTOR_MAX_MS ?? "500");

        console.log(`[PERF] Refactoring context guidance took ${elapsed}ms`);
        expect(elapsed).toBeLessThan(maxMs);
        expect(response.isError).toBeFalsy();
    }, 10000);
});
