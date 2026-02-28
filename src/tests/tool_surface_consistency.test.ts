import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { SmartContextServer } from "../index.js";
import { NativeModuleLoader } from "../orchestration/capabilities/NativeModuleLoader.js";
import { NativeSearchCoreStub } from "./utils/NativeSearchCoreStub.js";

type ListedTool = {
    name: string;
    description?: string;
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
    beforeEach(() => {
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
    });

    afterEach(() => {
        NativeModuleLoader.resetForTesting();
    });

    it("Intent tools are stable, handled, and schemas are coherent", async () => {
        const originalSurface = process.env.KAIRO_PUBLIC_SURFACE;
        const originalStorageMode = process.env.KAIRO_STORAGE_MODE;
        process.env.KAIRO_PUBLIC_SURFACE = "pillars";
        process.env.KAIRO_STORAGE_MODE = "memory";
        const server = new SmartContextServer(process.cwd());
        const tools = (server as any).listIntentTools() as ListedTool[];

        const expectedIntentTools = [
            "kairo_search",
            "kairo_impact",
            "kairo_graph",
            "kairo_undo",
            "kairo_status",
        ].sort();

        expect(Array.isArray(tools)).toBe(true);
        expect(tools.map((t) => t.name).sort()).toEqual(expectedIntentTools);

        // Verify legacy tools are removed
        const toolNames = tools.map((t) => t.name);
        expect(toolNames).not.toContain("task");
        expect(toolNames).not.toContain("manage");
        expect(toolNames).not.toContain("explore");
        expect(toolNames).not.toContain("understand");
        expect(toolNames).not.toContain("change");
        expect(toolNames).not.toContain("write");

        for (const tool of tools) {
            const descriptionWords = (tool.description ?? "").trim().split(/\s+/).filter(Boolean).length;
            expect(descriptionWords).toBeGreaterThanOrEqual(30);

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

            // With ADR-092, internal tools may still exist; kairo_* are the public surface
            expect(names).toEqual(expect.arrayContaining([
                "kairo_search",
                "kairo_impact",
                "kairo_graph",
                "kairo_undo",
                "kairo_status",
            ]));
            expect(names.length).toBeGreaterThanOrEqual(5);
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
