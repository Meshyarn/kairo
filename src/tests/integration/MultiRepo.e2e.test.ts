import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RepoRegistry } from "../../config/RepoRegistry.js";
import { IndexDatabase } from "../../indexing/IndexDatabase.js";
import { MultiRepoIndexCoordinator } from "../../indexing/MultiRepoIndexCoordinator.js";
import { PathManager } from "../../utils/PathManager.js";

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "multi-repo-e2e-"));

describe("Multi-repo E2E", () => {
    it("indexes and searches across multiple repositories", () => {
        const root = createTempDir();
        const repoA = path.join(root, "repo-a");
        const repoB = path.join(root, "repo-b");
        fs.mkdirSync(repoA, { recursive: true });
        fs.mkdirSync(repoB, { recursive: true });

        PathManager.setRoot(root);
        const configDir = path.join(root, ".kairo", "config");
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, ".mcp-config.json"), JSON.stringify({
            version: "1.0",
            repositories: {
                a: { path: "repo-a", name: "Repo A", type: "primary", languages: ["typescript"] },
                b: { path: "repo-b", name: "Repo B", type: "linked", languages: ["python"] }
            },
            defaultRepo: "a"
        }, null, 2));

        const registry = new RepoRegistry(root);
        const coordinator = new MultiRepoIndexCoordinator(registry);
        const dbs = (coordinator as unknown as { indexDatabases: Map<string, IndexDatabase> }).indexDatabases;
        const dbA = dbs.get("a");
        const dbB = dbs.get("b");
        if (!dbA || !dbB) {
            throw new Error("Expected repo databases to be initialized");
        }
        dbA.replaceSymbols({
            relativePath: "src/a.ts",
            lastModified: Date.now(),
            language: "typescript",
            symbols: [{
                name: "CrossRepoSymbol",
                type: "function",
                range: { startLine: 1, endLine: 1, startByte: 0, endByte: 10 }
            }]
        });
        dbB.replaceSymbols({
            relativePath: "src/b.py",
            lastModified: Date.now(),
            language: "python",
            symbols: [{
                name: "CrossRepoSymbol",
                type: "function",
                range: { startLine: 1, endLine: 1, startByte: 0, endByte: 10 }
            }]
        });
        const results = coordinator.searchSymbolsAcrossRepos("CrossRepoSymbol", { limit: 10 });

        expect(results).toHaveLength(2);
        expect(results.map(result => result.repoId).sort()).toEqual(["a", "b"]);

        registry.dispose();
        PathManager.setRoot(process.cwd());
        fs.rmSync(root, { recursive: true, force: true });
    });
});
