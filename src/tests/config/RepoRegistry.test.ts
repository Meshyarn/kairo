import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RepoRegistry } from "../../config/RepoRegistry.js";
import { PathManager } from "../../utils/PathManager.js";

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "repo-registry-"));

describe("RepoRegistry", () => {
    it("loads repositories from config and resolves paths", () => {
        const root = createTempDir();
        PathManager.setRoot(root);
        const configDir = path.join(root, ".kairo", "config");
        fs.mkdirSync(configDir, { recursive: true });

        const config = {
            version: "1.0",
            repositories: {
                main: { path: ".", name: "Main", type: "primary", languages: ["typescript"] },
                api: { path: "../api", name: "API", type: "linked", languages: ["python"] }
            },
            defaultRepo: "main"
        };
        fs.writeFileSync(path.join(configDir, "mcp-config.json"), JSON.stringify(config, null, 2));

        const registry = new RepoRegistry(root);
        const allRepos = registry.getAllRepos();
        expect(allRepos).toHaveLength(2);
        expect(registry.getDefaultRepo()?.id).toBe("main");

        const main = registry.getRepo("main");
        const api = registry.getRepo("api");
        expect(main?.path).toBe(path.resolve(root, "."));
        expect(api?.path).toBe(path.resolve(root, "../api"));
        expect(registry.findRepoByPath(path.join(root, "src", "index.ts"))?.id).toBe("main");

        registry.dispose();
        PathManager.setRoot(process.cwd());
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("falls back to default repo when config is missing", () => {
        const root = createTempDir();
        PathManager.setRoot(root);

        const registry = new RepoRegistry(root);
        const defaultRepo = registry.getDefaultRepo();

        expect(defaultRepo?.id).toBe("default");
        expect(defaultRepo?.path).toBe(path.resolve(root, "."));

        registry.dispose();
        PathManager.setRoot(process.cwd());
        fs.rmSync(root, { recursive: true, force: true });
    });
});
