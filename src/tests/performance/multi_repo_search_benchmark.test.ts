import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RepoRegistry } from "../../config/RepoRegistry.js";
import { MultiRepoIndexCoordinator } from "../../indexing/MultiRepoIndexCoordinator.js";
import { PathManager } from "../../utils/PathManager.js";

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "multi-repo-perf-"));

describe("Performance - multi-repo symbol search", () => {
    it("searches symbols across repos in a reasonable time", () => {
        const root = createTempDir();
        const repoA = path.join(root, "repo-a");
        const repoB = path.join(root, "repo-b");
        fs.mkdirSync(repoA, { recursive: true });
        fs.mkdirSync(repoB, { recursive: true });

        PathManager.setRoot(root);
        const configDir = path.join(root, ".kairo", "config");
        fs.mkdirSync(configDir, { recursive: true });
        const config = {
            version: "1.0",
            repositories: {
                a: { path: "repo-a", name: "Repo A", type: "primary", languages: ["typescript"] },
                b: { path: "repo-b", name: "Repo B", type: "linked", languages: ["python"] }
            },
            defaultRepo: "a"
        };
        fs.writeFileSync(path.join(configDir, "mcp-config.json"), JSON.stringify(config, null, 2));

        const registry = new RepoRegistry(root);
        const coordinator = new MultiRepoIndexCoordinator(registry);
        const dbs = (coordinator as any).indexDatabases as Map<string, any>;
        const dbA = dbs.get("a");
        const dbB = dbs.get("b");

        for (let i = 0; i < 200; i += 1) {
            dbA.replaceSymbols({
                relativePath: `src/a${i}.ts`,
                lastModified: Date.now(),
                language: "typescript",
                symbols: [{ name: `Symbol${i}`, kind: "function", range: { startLine: 1, endLine: 1 } }]
            });
            dbB.replaceSymbols({
                relativePath: `src/b${i}.py`,
                lastModified: Date.now(),
                language: "python",
                symbols: [{ name: `Symbol${i}`, kind: "function", range: { startLine: 1, endLine: 1 } }]
            });
        }

        const start = Date.now();
        const results = coordinator.searchSymbolsAcrossRepos("Symbol199", { limit: 10 });
        const elapsed = Date.now() - start;
        console.log(`[PERF] multi-repo search took ${elapsed}ms`);
        expect(results.length).toBeGreaterThan(0);

        registry.dispose();
        PathManager.setRoot(process.cwd());
        fs.rmSync(root, { recursive: true, force: true });
    }, 10000);
});
