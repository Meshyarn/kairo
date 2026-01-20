import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { ManageHandlers } from "../../handlers/ManageHandlers.js";
import { createDefaultToolSpecRegistry } from "../../server/tools/ToolSpecRegistry.js";

const makeTempDir = () => {
    return fs.mkdtempSync(path.join(os.tmpdir(), "kairo-config-"));
};

const makeContext = (rootPath: string) => ({
    rootPath,
    toolSpecRegistry: createDefaultToolSpecRegistry(),
    isTestEnv: () => true,
    indexDatabase: {
        listFiles: () => []
    }
});

const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, "utf-8"));

describe("ManageHandlers config bootstrap", () => {
    it("plans MCP config for init", async () => {
        const root = makeTempDir();
        fs.mkdirSync(path.join(root, "src"), { recursive: true });
        fs.writeFileSync(path.join(root, "src", "main.ts"), "export const value = 1;", "utf-8");

        const handler = new ManageHandlers(makeContext(root) as any);
        const raw = (handler as any).manageProjectRaw.bind(handler);
        const result = await raw({ command: "init", mode: "plan" });

        expect(result.success).toBe(true);
        const plan = result.plan as Array<{ op: string; path: string }>;
        const paths = plan.map((entry) => entry.path);
        expect(paths).toContain(path.join(root, ".kairo", "config", ".mcp-config.json"));
        expect(paths).not.toContain(path.join(root, ".kairo", "config", "mcp-config.json"));
        expect(paths).not.toContain(path.join(root, ".mcp-config.json"));
        expect(result.detected.languages.some((lang: any) => lang.languageId === "typescript")).toBe(true);
    });

    it("applies config files and writes backups on update", async () => {
        const root = makeTempDir();
        fs.mkdirSync(path.join(root, "src"), { recursive: true });
        fs.writeFileSync(path.join(root, "src", "main.ts"), "export const value = 1;", "utf-8");
        const mcpConfigPath = path.join(root, ".kairo", "config", ".mcp-config.json");
        fs.mkdirSync(path.dirname(mcpConfigPath), { recursive: true });
        fs.writeFileSync(mcpConfigPath, "{}", "utf-8");

        const handler = new ManageHandlers(makeContext(root) as any);
        const raw = (handler as any).manageProjectRaw.bind(handler);
        const result = await raw({ command: "init", mode: "apply" });

        expect(result.success).toBe(true);
        expect(fs.existsSync(path.join(root, ".kairo", "config", ".mcp-config.json"))).toBe(true);
        const backups = fs.readdirSync(path.join(root, ".kairo", "config"))
            .filter((name) => name.startsWith(".mcp-config.json.bak."));
        expect(backups.length).toBeGreaterThan(0);
    });

    it("flags legacy multiRepo/languages and plans migrations", async () => {
        const root = makeTempDir();
        const legacy = {
            multiRepo: {
                version: "1.0",
                defaultRepo: "main",
                repositories: {
                    main: { path: ".", name: "Main", type: "primary", languages: ["typescript"] }
                }
            },
            languages: {
                version: 1,
                mappings: { ".ts": { languageId: "typescript", parserBackend: "web-tree-sitter" } }
            }
        };
        fs.writeFileSync(path.join(root, ".mcp-config.json"), JSON.stringify(legacy, null, 2), "utf-8");

        const handler = new ManageHandlers(makeContext(root) as any);
        const raw = (handler as any).manageProjectRaw.bind(handler);
        const result = await raw({ command: "doctor", mode: "plan" });

        const codes = result.findings.map((finding: any) => finding.code);
        expect(codes).toContain("MIGRATION_NEEDED");
        expect(result.rollout).toBeDefined();
        const planPaths = result.plan.map((entry: any) => entry.path);
        expect(planPaths).toContain(path.join(root, ".kairo", "config", ".mcp-config.json"));
        expect(planPaths).not.toContain(path.join(root, ".kairo", "config", "mcp-config.json"));
        expect(planPaths).toContain(path.join(root, ".kairo", "config", "languages.json"));
    });

    it("plans VSCode MCP config when requested", async () => {
        const root = makeTempDir();
        const handler = new ManageHandlers(makeContext(root) as any);
        const raw = (handler as any).manageProjectRaw.bind(handler);
        const result = await raw({ command: "init", mode: "plan", targets: ["vscode"] });

        const plan = result.plan as Array<{ op: string; path: string; content?: string }>;
        const vscodePlan = plan.find((entry) => entry.path.endsWith(path.join(".vscode", "mcp.json")));
        expect(vscodePlan).toBeDefined();
        const content = JSON.parse(vscodePlan?.content ?? "{}");
        expect(content.servers?.kairo?.env?.KAIRO_LOG_TO_FILE).toBe("true");
    });

    it("surfaces repo config conflicts as blocking findings", async () => {
        const root = makeTempDir();
        const configDir = path.join(root, ".kairo", "config");
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, ".mcp-config.json"), JSON.stringify({
            version: "1.0",
            defaultRepo: "main",
            repositories: {
                main: { path: "apps/main", name: "Main", type: "primary", languages: ["typescript"] }
            }
        }, null, 2), "utf-8");

        const handler = new ManageHandlers(makeContext(root) as any);
        const raw = (handler as any).manageProjectRaw.bind(handler);
        const result = await raw({ command: "init", mode: "plan" });

        const codes = result.findings.map((finding: any) => finding.code);
        expect(codes).toContain("CONFIG_CONFLICT");
        const repoPlan = result.plan.find((entry: any) => entry.path.endsWith(path.join(".kairo", "config", ".mcp-config.json")));
        expect(repoPlan?.op).toBe("noop");
    });

    it("flags missing package alias details in contract scope", async () => {
        const root = makeTempDir();
        const configDir = path.join(root, ".kairo", "config");
        fs.mkdirSync(configDir, { recursive: true });
        fs.mkdirSync(path.join(root, ".kairo", "contracts", "ffi_napi"), { recursive: true });
        fs.writeFileSync(path.join(root, ".kairo", "contracts", "ffi_napi", "placeholder.json"), "{}", "utf-8");

        const config = {
            version: "1.0",
            repositories: {
                main: { path: ".", name: "Main", type: "primary", languages: ["typescript"] },
                "core-rs": { path: "crates/core-rs", name: "core-rs", type: "linked", languages: ["rust"] }
            },
            defaultRepo: "main"
        };
        fs.writeFileSync(path.join(configDir, ".mcp-config.json"), JSON.stringify(config, null, 2));
        const coreRoot = path.join(root, "crates", "core-rs");
        fs.mkdirSync(coreRoot, { recursive: true });
        fs.writeFileSync(path.join(coreRoot, "Cargo.toml"), "[package]\nname = \"core-rs\"\nversion = \"0.1.0\"\n");

        const handler = new ManageHandlers(makeContext(root) as any);
        const raw = (handler as any).manageProjectRaw.bind(handler);
        const result = await raw({ command: "doctor", mode: "plan", scope: "contracts" });

        const codes = result.findings.map((finding: any) => finding.code);
        expect(codes).toContain("CONTRACT_ALIAS_MISSING");
    });

    it("applies contracts bootstrap on doctor apply", async () => {
        const root = makeTempDir();
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
        fs.writeFileSync(path.join(configDir, ".mcp-config.json"), JSON.stringify(config, null, 2));

        const coreRoot = path.join(root, "crates", "core-rs");
        fs.mkdirSync(coreRoot, { recursive: true });
        fs.writeFileSync(path.join(coreRoot, "package.json"), JSON.stringify({
            name: "@kairo/core-rs",
            types: "index.d.ts"
        }, null, 2));
        fs.writeFileSync(path.join(coreRoot, "Cargo.toml"), "[package]\nname = \"core-rs\"\nversion = \"0.1.0\"\n");
        fs.writeFileSync(path.join(coreRoot, "index.d.ts"), "export interface ChunkResult { text: string; }\n");

        const handler = new ManageHandlers(makeContext(root) as any);
        const raw = (handler as any).manageProjectRaw.bind(handler);
        const result = await raw({ command: "doctor", mode: "apply", scope: "contracts" });

        expect(result.success).toBe(true);
        expect(fs.existsSync(path.join(root, ".kairo", "contracts", "ffi_napi"))).toBe(true);
        expect(fs.existsSync(path.join(root, ".kairo", "contracts", "ffi_napi", "@kairo__core-rs.json"))).toBe(true);
    });
});
