import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { AstManager } from "../../ast/AstManager.js";

describe("AstManager Branches", () => {
    let manager: AstManager;

    beforeEach(() => {
        manager = AstManager.getInstance();
    });

    it("covers resolveLanguageId branches", () => {
        const managerAny = manager as any;

        // Branch: mapping exists (might be "ts" or "typescript" based on config)
        const langId = manager.getLanguageId("a.ts");
        expect(["ts", "typescript"]).toContain(langId);

        // Branch: no mapping, but has extension
        expect(manager.getLanguageId("a.unknown")).toBe("plain_text");

        // Branch: no mapping, no extension
        expect(manager.getLanguageId("nofile")).toBe("plain_text");
    });

    it("covers dispose branches", async () => {
        const managerAny = manager as any;
        const mockBackend = { dispose: jest.fn() };
        managerAny.backend = mockBackend;
        
        await manager.dispose();
        expect(mockBackend.dispose).toHaveBeenCalled();

        // Branch: backend without dispose
        managerAny.backend = {};
        await manager.dispose(); // Should not throw
    });
});
