import { describe, it, beforeEach, afterEach, expect, jest } from "@jest/globals";
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

describe("SmartContextServer helpers", () => {
    let tempDir: string;
    let server: SmartContextServer;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-server-"));
        server = new SmartContextServer(tempDir);
    });

    afterEach(async () => {
        await server.shutdown();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("exposes internal and file tools when enabled", () => {
        const snapshot = captureEnv([
            "KAIRO_EXPOSE_INTERNAL_TOOLS",
            "KAIRO_EXPOSE_FILE_TOOLS"
        ]);
        process.env.KAIRO_EXPOSE_INTERNAL_TOOLS = "true";
        process.env.KAIRO_EXPOSE_FILE_TOOLS = "true";

        const tools = (server as any).listIntentTools();
        const names = tools.map((tool: any) => tool.name);
        expect(names).toContain("code_read");
        expect(names).toContain("file_write");
        expect(names).toContain("file_analyze");
        expect(names).toContain("change");

        restoreEnv(snapshot);
    });

    it("resolves rollout users and validates required args", () => {
        const snapshot = captureEnv([
            "KAIRO_ROLLOUT_USER",
            "KAIRO_USER_ID",
            "KAIRO_DEFAULT_USER"
        ]);
        process.env.KAIRO_DEFAULT_USER = "env-user";

        const missing = (server as any).validateRequiredArgs("file_write", {});
        expect(missing).toEqual(["filePath", "content"]);
        expect((server as any).validateRequiredArgs("unknown_tool", {})).toEqual([]);

        const args = {
            user: { id: "user-1" },
            headers: { "X-User-Id": "header-user" }
        };
        expect((server as any).resolveRolloutUser(args)).toBe("user-1");

        const headerArgs = { headers: { "X-GitHub-User": " octo " } };
        expect((server as any).resolveRolloutUser(headerArgs)).toBe("octo");
        expect((server as any).buildRolloutContext(headerArgs)).toEqual({ userId: "octo" });

        expect((server as any).resolveRolloutUser({})).toBe("env-user");

        restoreEnv(snapshot);
    });

    it("formats responses and resolves paths", () => {
        const snapshot = captureEnv(["KAIRO_ALERT_SEVERITY"]);

        const mapPayload = { map: new Map([["key", 1]]), set: new Set(["a"]) };
        const json = (server as any).jsonResponse(mapPayload);
        const parsed = JSON.parse(json.content[0].text);
        expect(parsed.map.__type).toBe("Map");
        expect(parsed.map.entries).toEqual([["key", 1]]);
        expect(parsed.set.__type).toBe("Set");
        expect(parsed.set.values).toEqual(["a"]);

        const text = (server as any).textResponse("ok");
        expect(text.content[0].text).toBe("ok");

        const error = (server as any).errorResponse("ERR", "message", { detail: true });
        expect(error.isError).toBe(true);
        const errorPayload = JSON.parse(error.content[0].text);
        expect(errorPayload).toEqual({ errorCode: "ERR", message: "message", details: { detail: true } });

        const relative = (server as any).resolveRelativePath(path.join(tempDir, "src", "index.ts"));
        expect(relative).toBe("src/index.ts");
        const absolute = (server as any).resolveAbsolutePath("src/index.ts");
        expect(absolute).toBe(path.join(tempDir, "src", "index.ts"));

        expect((server as any).parseNumberEnv("42", 7)).toBe(42);
        expect((server as any).parseNumberEnv("nope", 7)).toBe(7);
        process.env.KAIRO_ALERT_SEVERITY = "critical";
        expect((server as any).resolveAlertSeverity()).toBe("critical");
        process.env.KAIRO_ALERT_SEVERITY = "invalid";
        expect((server as any).resolveAlertSeverity()).toBe("warning");

        restoreEnv(snapshot);
    });

    it("applies ignore patterns across engines", async () => {
        const symbolSpy = jest.spyOn((server as any).symbolIndex, "updateIgnorePatterns");
        const contextSpy = jest.spyOn((server as any).contextEngine, "updateIgnoreFilter");
        const searchSpy = jest.spyOn((server as any).searchEngine, "updateExcludeGlobs")
            .mockResolvedValue(undefined);
        const docIndexer = (server as any).documentIndexer;
        const docSpy = docIndexer ? jest.spyOn(docIndexer, "updateIgnorePatterns") : null;

        const ignoreFilter = (server as any).createIgnoreFilter(["dist/**"]);
        expect(ignoreFilter.ignores("dist/file.txt")).toBe(true);

        (server as any).applyIgnorePatterns(["dist/**"]);

        expect(symbolSpy).toHaveBeenCalledWith(["dist/**"]);
        expect(contextSpy).toHaveBeenCalled();
        expect(searchSpy).toHaveBeenCalledWith(["dist/**"]);
        if (docSpy) {
            expect(docSpy).toHaveBeenCalledWith(["dist/**"]);
        }

        symbolSpy.mockRestore();
        contextSpy.mockRestore();
        searchSpy.mockRestore();
        docSpy?.mockRestore();
    });

    it("wraps legacy results and recognizes pillar tools", async () => {
        const registry = (server as any).internalRegistry;
        registry.register("test_tool", () => "ok");
        const legacyResult = await (server as any).handleCallToolLegacy("test_tool", {});
        expect(legacyResult.content[0].text).toBe("ok");

        expect((server as any).isPillarTool("explore")).toBe(true);
        expect((server as any).isPillarTool("unknown")).toBe(false);
    });

});
