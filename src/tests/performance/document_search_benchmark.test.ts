import { SmartContextServer } from "../../index.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("Performance - document_search", () => {
    let server: SmartContextServer;
    let perfTestDir: string;

    beforeAll(() => {
        perfTestDir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-search-perf-"));
        fs.mkdirSync(path.join(perfTestDir, "docs"), { recursive: true });

        for (let i = 0; i < 120; i++) {
            const content = `# Doc ${i}\n` + "lorem ipsum ".repeat(200) + `unique_doc_token_${i}\n`;
            fs.writeFileSync(path.join(perfTestDir, "docs", `doc_${i}.md`), content);
        }

        server = new SmartContextServer(perfTestDir);
    });

    afterAll(async () => {
        await server.shutdown();
        fs.rmSync(perfTestDir, { recursive: true, force: true });
    });

    it("should search documents in a reasonable time", async () => {
        const startTime = Date.now();

        const response = await (server as any).handleCallTool("document_search", {
            query: "unique_doc_token_42",
            output: "compact",
            maxResults: 5,
            maxCandidates: 40
        });

        const endTime = Date.now();
        console.log(`[PERF] document_search took ${endTime - startTime}ms`);

        expect(response.isError).toBeFalsy();
        const result = JSON.parse(response.content[0].text);
        expect(Array.isArray(result.results)).toBe(true);
        expect(result.results.length).toBeGreaterThan(0);
    }, 15000);
});
