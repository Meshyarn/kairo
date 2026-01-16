import { describe, beforeEach, afterEach, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SmartContextServer } from "../../index.js";

const runTool = async (server: SmartContextServer, toolName: string, args: any) => {
    const response = await (server as any).handleCallTool(toolName, args);
    expect(response).toBeDefined();
    expect(response.isError).not.toBe(true);
    return JSON.parse(response.content[0].text);
};

describe("Mixed workflow external edit", () => {
    let server: SmartContextServer;
    let testRoot: string;

    beforeEach(async () => {
        testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-external-edit-"));
        fs.mkdirSync(path.join(testRoot, "src"), { recursive: true });
        fs.writeFileSync(path.join(testRoot, "src", "app.ts"), "export const value = 1;\n", "utf-8");
        server = new SmartContextServer(testRoot);
        await server.waitForInitialScan();
    });

    afterEach(async () => {
        await server.shutdown();
        fs.rmSync(testRoot, { recursive: true, force: true });
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
