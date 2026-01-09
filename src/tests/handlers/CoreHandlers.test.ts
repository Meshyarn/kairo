import { describe, it, expect, jest } from "@jest/globals";
import type { HandlerContext } from "../../handlers/HandlerContext.js";
import { SearchHandlers } from "../../handlers/SearchHandlers.js";
import { CodeHandlers } from "../../handlers/CodeHandlers.js";
import { EditHandlers } from "../../handlers/EditHandlers.js";
import { DocumentHandlers } from "../../handlers/DocumentHandlers.js";
import { ManageHandlers } from "../../handlers/ManageHandlers.js";

describe("Core Handlers", () => {
    it("handles file_search using the search engine", async () => {
        const searchEngine = {
            scout: async () => [{ filePath: "src/app.ts", preview: "hit", score: 1 }]
        } as any;
        const context = { searchEngine } as HandlerContext;
        const handler = new SearchHandlers(context);

        const result = await handler.handle("file_search", { query: "hit" });
        const payload = JSON.parse(result.content[0].text);
        expect(payload).toHaveLength(1);
        expect(payload[0].filePath).toBe("src/app.ts");
    });

    it("handles file_stat via CodeHandlers", async () => {
        const fileSystem = {
            stat: async () => ({
                size: 10,
                mtime: new Date("2024-01-01T00:00:00.000Z"),
                isDirectory: () => false
            })
        } as any;
        const pathNormalizer = {
            normalize: (value: string) => value,
            toAbsolute: (value: string) => value
        };
        const context = { fileSystem, pathNormalizer } as HandlerContext;
        const handler = new CodeHandlers(context);

        const result = await handler.handle("file_stat", { path: "src/app.ts" });
        const payload = JSON.parse(result.content[0].text);
        expect(payload.path).toBe("src/app.ts");
        expect(payload.size).toBe(10);
        expect(payload.isDirectory).toBe(false);
    });

    it("handles file_write via EditHandlers", async () => {
        const fileSystem = {
            writeFile: jest.fn(async () => undefined)
        } as any;
        const fileVersionManager = {
            incrementVersion: jest.fn()
        } as any;
        const indexStateManager = {
            markDirty: jest.fn()
        } as any;
        const incrementalIndexer = {
            enqueuePaths: jest.fn()
        } as any;
        const pathNormalizer = {
            normalize: (value: string) => value,
            toAbsolute: (value: string) => `/abs/${value}`
        };
        const context = { fileSystem, fileVersionManager, pathNormalizer, indexStateManager, incrementalIndexer } as HandlerContext;
        const handler = new EditHandlers(context);

        const result = await handler.handle("file_write", { filePath: "notes.txt", content: "hello" });
        const payload = JSON.parse(result.content[0].text);
        expect(payload.success).toBe(true);
        expect(fileSystem.writeFile).toHaveBeenCalledWith("/abs/notes.txt", "hello");
        expect(fileVersionManager.incrementVersion).toHaveBeenCalledWith("/abs/notes.txt", "hello");
    });

    it("handles document_search via DocumentHandlers", async () => {
        const documentSearchEngine = {
            search: async () => ({ results: [{ id: "doc-1" }] })
        } as any;
        const context = { documentSearchEngine } as HandlerContext;
        const handler = new DocumentHandlers(context);

        const result = await handler.handle("document_search", { query: "hello" });
        const payload = JSON.parse(result.content[0].text);
        expect(payload.results[0].id).toBe("doc-1");
    });

    it("handles project_manage metrics", async () => {
        const context = {} as HandlerContext;
        const handler = new ManageHandlers(context);

        const result = await handler.handle("project_manage", { command: "metrics" });
        const payload = JSON.parse(result.content[0].text);
        expect(payload.success).toBe(true);
        expect(payload.metrics).toBeDefined();
    });
});
