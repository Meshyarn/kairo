
import { SmartContextServer } from "../../index.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FileSearchResult } from "../../types.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Performance - file_search', () => {
    let server: SmartContextServer;
    let perfTestDir: string;

    beforeAll(() => {
        perfTestDir = fs.mkdtempSync(path.join(os.tmpdir(), "perf-search-"));

        for (let i = 0; i < 100; i++) {
            const content = `File ${i}\n` + 'some random text '.repeat(100) + `unique keyword ${i}`;
            fs.writeFileSync(path.join(perfTestDir, `perf_file_${i}.txt`), content);
        }

        server = new SmartContextServer(perfTestDir);
    });

    afterAll(() => {
        if (fs.existsSync(perfTestDir)) {
            fs.rmSync(perfTestDir, { recursive: true, force: true });
        }
    });

    it('should search 100 files in a reasonable time', async () => {
        const startTime = Date.now();

        const args = { query: 'unique keyword 50' };
        const response = await (server as any).handleCallTool('file_search', args);

        const endTime = Date.now();
        console.log(`[PERF] file_search took ${endTime - startTime}ms`);

        expect(response.isError).toBeFalsy();
        const result: FileSearchResult[] = JSON.parse(response.content[0].text);
        expect(result.length).toBeGreaterThan(0);
    }, 10000); // 10 seconds timeout for this test
});
