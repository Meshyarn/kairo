import { describe, it, expect } from "@jest/globals";
import { SmartContextServer } from "../index.js";

type ListedTool = {
    name: string;
    inputSchema?: {
        type?: string;
        properties?: Record<string, unknown>;
        required?: string[];
    };
};

const readErrorCode = (response: any): string | undefined => {
    if (!response?.isError) return undefined;
    try {
        const parsed = JSON.parse(response.content?.[0]?.text ?? "{}");
        return parsed?.errorCode;
    } catch {
        return undefined;
    }
};

/**
 * Stronger tool surface consistency checks.
 *
 * We still avoid executing potentially expensive tools.
 * - Additionally: validate `inputSchema.required` is consistent with `properties`.
 * - Additionally: for tools that declare required params, calling with `{}` should error quickly
 *   (i.e. not succeed, and not `UnknownTool`).
 */
describe("Tool surface consistency", () => {
    it("Intent tools are stable, handled, and schemas are coherent", async () => {
        const originalSurface = process.env.KAIRO_PUBLIC_SURFACE;
        const originalStorageMode = process.env.KAIRO_STORAGE_MODE;
        process.env.KAIRO_PUBLIC_SURFACE = "pillars";
        process.env.KAIRO_STORAGE_MODE = "memory";
        const server = new SmartContextServer(process.cwd());
        const tools = (server as any).listIntentTools() as ListedTool[];

        const expectedIntentTools = [
            "task",
            "understand",
            "explore",
            "change",
            "write",
            "manage",
        ].sort();

        expect(Array.isArray(tools)).toBe(true);
        expect(tools.map((t) => t.name).sort()).toEqual(expectedIntentTools);


        for (const tool of tools) {
            const schema = tool.inputSchema;
            if (!schema) {
                continue;
            }

            const properties = schema.properties ?? {};
            const required = Array.isArray(schema.required) ? schema.required : [];

            for (const key of required) {
                expect(Object.prototype.hasOwnProperty.call(properties, key)).toBe(true);
            }

            // Only execute tools that declare required params; these should fail fast with empty args.
            if (required.length > 0) {
                const response = await (server as any).handleCallTool(tool.name, {});
                const errorCode = readErrorCode(response);

                expect(response?.isError).toBe(true);
                expect(errorCode).toBe("MissingParameter");
            }

        }
        await server.shutdown();
        if (originalSurface === undefined) {
            delete process.env.KAIRO_PUBLIC_SURFACE;
        } else {
            process.env.KAIRO_PUBLIC_SURFACE = originalSurface;
        }
        if (originalStorageMode === undefined) {
            delete process.env.KAIRO_STORAGE_MODE;
        } else {
            process.env.KAIRO_STORAGE_MODE = originalStorageMode;
        }
        });

    it("Internal tools are exposed only when enabled", async () => {
        const prevLegacy = process.env.KAIRO_EXPOSE_INTERNAL_TOOLS;
        const prev = process.env.KAIRO_EXPOSE_FILE_TOOLS;
        const originalStorageMode = process.env.KAIRO_STORAGE_MODE;
        process.env.KAIRO_EXPOSE_INTERNAL_TOOLS = "true";
        process.env.KAIRO_EXPOSE_FILE_TOOLS = "true";
        process.env.KAIRO_STORAGE_MODE = "memory";

        try {
            const server = new SmartContextServer(process.cwd());
            const tools = (server as any).listIntentTools() as ListedTool[];
            const names = tools.map((t) => t.name);

            expect(names).toEqual(expect.arrayContaining([
                "code_read",
                "project_search",
                "relationship_analyze",
                "edit_apply",
                "edit_guidance",
                "project_manage",
                "interface_reconstruct",
                "understand",
                "explore",
                "change",
                "write",
                "manage",
                "file_read",
                "file_write",
                "file_analyze",
            ]));
            expect(names.length).toBeGreaterThan(5);
            await server.shutdown();
        } finally {
            if (prev === undefined) {
                delete process.env.KAIRO_EXPOSE_FILE_TOOLS;
            } else {
                process.env.KAIRO_EXPOSE_FILE_TOOLS = prev;
            }
            if (prevLegacy === undefined) {
                delete process.env.KAIRO_EXPOSE_INTERNAL_TOOLS;
            } else {
                process.env.KAIRO_EXPOSE_INTERNAL_TOOLS = prevLegacy;
            }
            if (originalStorageMode === undefined) {
                delete process.env.KAIRO_STORAGE_MODE;
            } else {
                process.env.KAIRO_STORAGE_MODE = originalStorageMode;
            }
        }
    });
});
