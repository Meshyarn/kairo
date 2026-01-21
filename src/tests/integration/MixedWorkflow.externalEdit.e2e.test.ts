import { describe, beforeEach, afterEach, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SmartContextServer } from "../../index.js";
import { NativeModuleLoader } from "../../orchestration/capabilities/NativeModuleLoader.js";
import { NativeSearchCoreStub } from "../utils/NativeSearchCoreStub.js";

const runTool = async (server: SmartContextServer, toolName: string, args: any) => {
    const response = await (server as any).handleCallTool(toolName, args);
    expect(response).toBeDefined();
    expect(response.isError).not.toBe(true);
    return JSON.parse(response.content[0].text);
};

describe("Mixed workflow external edit", () => {
    let server: SmartContextServer;
    let testRoot: string;
    const originalMode = process.env.KAIRO_MODE;

    beforeEach(async () => {
        process.env.KAIRO_MODE = "dev";
        NativeModuleLoader.setTestLoader(() => ({
            SmartChunker: class {
                constructor(_modelPath: string) {}
                chunk(_text: string, _maxTokens: number, _overlap: number) { return []; }
            },
            diffUnified: (_oldText: string, _newText: string, _contextLines: number) => ({
                diff: "",
                added: 0,
                removed: 0
            }),
            validateSyntax: (_language: string, _content: string) => [],
            cosineScores: (_query: Float32Array, _vectors: Float32Array[]) => [],
            NativeSearchCore: class {
                private readonly core = new NativeSearchCoreStub();
                upsert(doc: any) { return this.core.upsert(doc); }
                upsertMany(docs: any[]) { return this.core.upsertMany(docs); }
                deleteDoc(target: any) { return this.core.deleteDoc(target); }
                commit() { return this.core.commit(); }
                search(query: any) { return this.core.search(query); }
                close() { return this.core.close(); }
                stats() { return this.core.stats(); }
                reset() { return this.core.reset(); }
            }
        }));
        testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-external-edit-"));
        fs.mkdirSync(path.join(testRoot, "src"), { recursive: true });
        fs.writeFileSync(path.join(testRoot, "src", "app.ts"), "export const value = 1;\n", "utf-8");
        server = new SmartContextServer(testRoot);
        await server.waitForInitialScan();
    });

    afterEach(async () => {
        await server.shutdown();
        fs.rmSync(testRoot, { recursive: true, force: true });
        NativeModuleLoader.resetForTesting();
        if (originalMode === undefined) {
            delete process.env.KAIRO_MODE;
        } else {
            process.env.KAIRO_MODE = originalMode;
        }
    });

    it("detects drift after external edit and suggests reindex", async () => {
        const relPath = path.join("src", "app.ts");
        const absPath = path.join(testRoot, relPath);

        const change = await runTool(server, "change", {
            intent: "Update value",
            targetFiles: [relPath],
            edits: [{ targetString: "value = 1", replacementString: "value = 2" }],
            options: { dryRun: false, includeImpact: false }
        });
        expect(change.success).toBe(true);

        fs.writeFileSync(absPath, "export const value = 3;\n", "utf-8");

        const status = await runTool(server, "project_manage", { command: "status" });
        expect(status.drift).toBeDefined();
        expect(status.drift.workspaceDrift).toBe("detected");
        const signals = status.drift.scopes.flatMap((scope: any) => scope.signals ?? []);
        expect(signals.some((signal: string) => signal === "mtime_changed" || signal === "hash_mismatch")).toBe(true);
        expect(Array.isArray(status.drift.repairActions)).toBe(true);
        expect(status.drift.repairActions.some((action: any) => action?.args?.command === "reindex")).toBe(true);
    });
});
