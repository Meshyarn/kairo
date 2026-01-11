import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PackageAliasMap } from "../../config/PackageAliasMap.js";
import { RepoRegistry } from "../../config/RepoRegistry.js";
import { PathManager } from "../../utils/PathManager.js";

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "pkg-alias-"));

describe("PackageAliasMap", () => {
    it("builds aliases from linked repos with package.json", () => {
        const root = createTempDir();
        PathManager.setRoot(root);
        const configDir = path.join(root, ".kairo", "config");
        fs.mkdirSync(configDir, { recursive: true });

        const coreRepo = path.join(root, "crates", "core-rs");
        fs.mkdirSync(coreRepo, { recursive: true });
        fs.writeFileSync(path.join(coreRepo, "package.json"), JSON.stringify({
            name: "@kairo/core-rs",
            types: "index.d.ts"
        }, null, 2));
        fs.writeFileSync(path.join(coreRepo, "index.d.ts"), "export interface ChunkResult {}");

        const config = {
            version: "1.0",
            repositories: {
                main: { path: ".", name: "Main", type: "primary", languages: ["typescript"] },
                "core-rs": { path: "crates/core-rs", name: "core-rs", type: "linked", languages: ["rust"] }
            },
            defaultRepo: "main"
        };
        fs.writeFileSync(path.join(configDir, "mcp-config.json"), JSON.stringify(config, null, 2));

        const registry = new RepoRegistry(root);
        const aliasMap = new PackageAliasMap(registry);
        aliasMap.build();

        const alias = aliasMap.resolve("@kairo/core-rs");
        expect(alias?.repoId).toBe("core-rs");
        expect(alias?.entryPath).toBe(path.join(coreRepo, "index.d.ts"));

        registry.dispose();
        PathManager.setRoot(process.cwd());
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("skips repos without package.json", () => {
        const root = createTempDir();
        PathManager.setRoot(root);
        const configDir = path.join(root, ".kairo", "config");
        fs.mkdirSync(configDir, { recursive: true });

        const config = {
            version: "1.0",
            repositories: {
                main: { path: ".", name: "Main", type: "primary", languages: ["typescript"] },
                "core-rs": { path: "crates/core-rs", name: "core-rs", type: "linked", languages: ["rust"] }
            },
            defaultRepo: "main"
        };
        fs.writeFileSync(path.join(configDir, "mcp-config.json"), JSON.stringify(config, null, 2));
        fs.mkdirSync(path.join(root, "crates", "core-rs"), { recursive: true });

        const registry = new RepoRegistry(root);
        const aliasMap = new PackageAliasMap(registry);
        aliasMap.build();

        expect(aliasMap.resolve("@kairo/core-rs")).toBeUndefined();

        registry.dispose();
        PathManager.setRoot(process.cwd());
        fs.rmSync(root, { recursive: true, force: true });
    });
});
