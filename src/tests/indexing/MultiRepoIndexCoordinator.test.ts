import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RepoRegistry } from "../../config/RepoRegistry.js";
import { MultiRepoIndexCoordinator } from "../../indexing/MultiRepoIndexCoordinator.js";
import { PathManager } from "../../utils/PathManager.js";

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "multi-repo-index-"));

describe("MultiRepoIndexCoordinator", () => {
    it("searches symbols across repositories", () => {
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
        dbA.replaceSymbols({
            relativePath: "src/a.ts",
            lastModified: Date.now(),
            language: "typescript",
            symbols: [{ name: "SharedSymbol", kind: "function", range: { startLine: 1, endLine: 1 } }]
        });
        dbB.replaceSymbols({
            relativePath: "src/b.py",
            lastModified: Date.now(),
            language: "python",
            symbols: [{ name: "SharedSymbol", kind: "function", range: { startLine: 1, endLine: 1 } }]
        });

        const results = coordinator.searchSymbolsAcrossRepos("SharedSymbol", { limit: 10 });
        expect(results).toHaveLength(2);
        const repoIds = results.map(result => result.repoId).sort();
        expect(repoIds).toEqual(["a", "b"]);

        registry.dispose();
        PathManager.setRoot(process.cwd());
        fs.rmSync(root, { recursive: true, force: true });
    });
});
