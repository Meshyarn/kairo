import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { SmartContextServer } from "../../index.js";

const captureEnv = (keys: string[]) => {
    const snapshot: Record<string, string | undefined> = {};
    for (const key of keys) {
        snapshot[key] = process.env[key];
    }
    return snapshot;
};

const restoreEnv = (snapshot: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(snapshot)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
};

describe("SmartContextServer Core", () => {
    let tempDir: string;
    let server: SmartContextServer;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-server-core-"));
        server = new SmartContextServer(tempDir);
    });

    afterEach(async () => {
        await server.shutdown();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("initializes with correct root path", () => {
        expect((server as any).rootPath).toBe(tempDir);
    });

    it("shuts down gracefully", async () => {
        const spy = jest.spyOn((server as any).searchEngine, "dispose");
        await server.shutdown();
        expect(spy).toHaveBeenCalled();
    });

    it("handles tool calls through modular handlers", async () => {
        const registry = (server as any).handlerRegistry;
        const mockResult = { content: [{ type: "text", text: "success" }] };
        jest.spyOn(registry, "handle").mockResolvedValue(mockResult);

        // kairo_search is a registered tool so it passes the toolSpec check
        const result = await (server as any).handleCallTool("kairo_search", { query: "test" });
        expect(result.content[0].text).toBe("success");
    });

    it("handles heartbeat logic", async () => {
        const snapshot = captureEnv(["KAIRO_HEARTBEAT_ENABLED"]);
        process.env.KAIRO_HEARTBEAT_ENABLED = "true";
        
        const serverAny = server as any;
        // Override isTestEnv to test the heartbeat branch
        jest.spyOn(serverAny, "isTestEnv").mockReturnValue(false);
        
        serverAny.startHeartbeat();
        expect(serverAny.heartbeatTimer).toBeDefined();
        
        const timer = serverAny.heartbeatTimer;
        serverAny.startHeartbeat(); // Already has timer
        expect(serverAny.heartbeatTimer).toBe(timer);

        serverAny.stopHeartbeat();
        expect(serverAny.heartbeatTimer).toBeUndefined();
        
        restoreEnv(snapshot);
    });

    it("validates required arguments for tools", () => {
        const serverAny = server as any;
        expect(serverAny.validateRequiredArgs("unknown_tool", {})).toEqual([]);
        // kairo_search requires 'query'
        expect(serverAny.validateRequiredArgs("kairo_search", {})).toEqual(["query"]);
        expect(serverAny.validateRequiredArgs("kairo_search", { query: "test" })).toEqual([]);
        // kairo_impact requires 'target'
        expect(serverAny.validateRequiredArgs("kairo_impact", {})).toEqual(["target"]);
    });

    it("applies ignore patterns across engines", async () => {
        const serverAny = server as any;
        const symbolSpy = jest.spyOn(serverAny.symbolIndex, "updateIgnorePatterns");
        const searchSpy = jest.spyOn(serverAny.searchEngine, "updateExcludeGlobs").mockResolvedValue(undefined as any);
        
        await serverAny.applyIgnorePatterns(["node_modules/**"]);
        
        expect(symbolSpy).toHaveBeenCalledWith(["node_modules/**"]);
        expect(searchSpy).toHaveBeenCalledWith(["node_modules/**"]);
    });
});
