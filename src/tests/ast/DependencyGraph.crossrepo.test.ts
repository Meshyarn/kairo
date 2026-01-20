import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DependencyGraph } from "../../ast/DependencyGraph.js";
import { ModuleResolver } from "../../ast/ModuleResolver.js";
import { PackageAliasMap } from "../../config/PackageAliasMap.js";
import { RepoRegistry } from "../../config/RepoRegistry.js";
import { PathManager } from "../../utils/PathManager.js";

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "dep-graph-alias-"));

describe("DependencyGraph cross-repo alias", () => {
    let root: string;
    let registry: RepoRegistry;

    beforeEach(() => {
        root = createTempDir();
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
        fs.writeFileSync(path.join(configDir, ".mcp-config.json"), JSON.stringify(config, null, 2));

        const coreRepo = path.join(root, "crates", "core-rs");
        fs.mkdirSync(coreRepo, { recursive: true });
        fs.writeFileSync(path.join(coreRepo, "package.json"), JSON.stringify({
            name: "@kairo/core-rs",
            types: "index.d.ts"
        }, null, 2));
        fs.writeFileSync(path.join(coreRepo, "index.d.ts"), "export interface ChunkResult {}");

        const consumerDir = path.join(root, "src");
        fs.mkdirSync(consumerDir, { recursive: true });
        fs.writeFileSync(
            path.join(consumerDir, "consumer.ts"),
            'import { SmartChunker } from "@kairo/core-rs";\nconst foo = SmartChunker;\n'
        );

        registry = new RepoRegistry(root);
    });

    afterEach(() => {
        registry.dispose();
        PathManager.setRoot(process.cwd());
        fs.rmSync(root, { recursive: true, force: true });
        jest.restoreAllMocks();
    });

    it("stores outgoing dependency edges for aliased packages", async () => {
        const aliasMap = new PackageAliasMap(registry);
        aliasMap.build();
        const resolver = new ModuleResolver({ rootPath: root, packageAliasMap: aliasMap });

        const edges = new Map<string, Array<{ targetPath: string; type: string; metadata?: any }>>();
        const db = {
            replaceDependencies: jest.fn((entry: any) => {
                edges.set(entry.relativePath, entry.outgoing ?? []);
            }),
            getDependencies: jest.fn((relativePath: string, direction: "incoming" | "outgoing") => {
                if (direction === "outgoing") {
                    const outgoing = edges.get(relativePath) ?? [];
                    return outgoing.map((edge) => ({
                        source: relativePath,
                        target: edge.targetPath,
                        type: edge.type,
                        metadata: edge.metadata
                    }));
                }
                const incoming: Array<{ source: string; target: string; type: string; metadata?: any }> = [];
                for (const [source, outgoing] of edges.entries()) {
                    for (const edge of outgoing) {
                        if (edge.targetPath === relativePath) {
                            incoming.push({
                                source,
                                target: edge.targetPath,
                                type: edge.type,
                                metadata: edge.metadata
                            });
                        }
                    }
                }
                return incoming;
            }),
            listFiles: jest.fn().mockReturnValue([]),
            listUnresolved: jest.fn().mockReturnValue([]),
            listUnresolvedForFile: jest.fn().mockReturnValue([]),
            countDependencies: jest.fn().mockReturnValue(0),
            deleteFilesByPrefix: jest.fn(),
            clearDependencies: jest.fn(),
            getFile: jest.fn(),
            countFiles: jest.fn().mockReturnValue(0)
        };
        const symbolIndex = {
            getDatabase: () => db
        };

        const graph = new DependencyGraph(root, symbolIndex as any, resolver);
        graph.setLoggingEnabled(false);

        const consumerPath = path.join(root, "src", "consumer.ts");
        await graph.updateFileDependencies(consumerPath);

        expect(db.replaceDependencies).toHaveBeenCalledTimes(1);
        const call = db.replaceDependencies.mock.calls[0][0];
        const outgoing = call.outgoing ?? [];
        expect(outgoing).toHaveLength(1);
        const targetPath = outgoing[0].targetPath as string;
        const expected = path.relative(root, path.join(root, "crates", "core-rs", "index.d.ts")).replace(/\\/g, "/");
        expect(targetPath).toBe(expected);
    });

    it("returns consumers via getImporters for aliased entry file", async () => {
        const aliasMap = new PackageAliasMap(registry);
        aliasMap.build();
        const resolver = new ModuleResolver({ rootPath: root, packageAliasMap: aliasMap });

        const edges = new Map<string, Array<{ targetPath: string; type: string; metadata?: any }>>();
        const db = {
            replaceDependencies: jest.fn((entry: any) => {
                edges.set(entry.relativePath, entry.outgoing ?? []);
            }),
            getDependencies: jest.fn((relativePath: string, direction: "incoming" | "outgoing") => {
                if (direction === "outgoing") {
                    const outgoing = edges.get(relativePath) ?? [];
                    return outgoing.map((edge) => ({
                        source: relativePath,
                        target: edge.targetPath,
                        type: edge.type,
                        metadata: edge.metadata
                    }));
                }
                const incoming: Array<{ source: string; target: string; type: string; metadata?: any }> = [];
                for (const [source, outgoing] of edges.entries()) {
                    for (const edge of outgoing) {
                        if (edge.targetPath === relativePath) {
                            incoming.push({
                                source,
                                target: edge.targetPath,
                                type: edge.type,
                                metadata: edge.metadata
                            });
                        }
                    }
                }
                return incoming;
            }),
            listFiles: jest.fn().mockReturnValue([]),
            listUnresolved: jest.fn().mockReturnValue([]),
            listUnresolvedForFile: jest.fn().mockReturnValue([]),
            countDependencies: jest.fn().mockReturnValue(0),
            deleteFilesByPrefix: jest.fn(),
            clearDependencies: jest.fn(),
            getFile: jest.fn(),
            countFiles: jest.fn().mockReturnValue(0)
        };
        const symbolIndex = {
            getDatabase: () => db
        };

        const graph = new DependencyGraph(root, symbolIndex as any, resolver);
        graph.setLoggingEnabled(false);

        const consumerPath = path.join(root, "src", "consumer.ts");
        await graph.updateFileDependencies(consumerPath);

        const entryFile = path.join(root, "crates", "core-rs", "index.d.ts");
        const importers = await graph.getImporters(entryFile);
        expect(importers).toHaveLength(1);
        expect(importers[0].from).toBe(consumerPath.replace(/\\/g, "/"));
    });
});
