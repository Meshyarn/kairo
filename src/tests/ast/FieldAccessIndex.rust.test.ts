import { jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { AstManager } from "../../ast/AstManager.js";
import { FieldAccessIndex } from "../../ast/FieldAccessIndex.js";

jest.setTimeout(20000);

describe("FieldAccessIndex (rust)", () => {
    let manager: AstManager;

    beforeAll(async () => {
        AstManager.resetForTesting();
        manager = AstManager.getInstance();
        await manager.init({ mode: "test", parserBackend: "wasm" });
    });

    afterAll(async () => {
        await AstManager.resetForTestingAsync();
    });

    it("tracks struct field access", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "field-access-rust-"));
        const filePath = path.join(root, "main.rs");
        fs.writeFileSync(
            filePath,
            `struct User {
    name: String,
}

fn main() {
    let user: User = User { name: "hi".to_string() };
    let _ = user.name;
}
`,
            "utf-8"
        );

        const index = new FieldAccessIndex(root, { astManager: manager });
        await index.indexFile(filePath, { packageName: "@kairo/core-rs", exportNames: ["User"] });
        const result = index.getUsages("@kairo/core-rs", "User", "name");
        expect(result.usages).toHaveLength(1);
        expect(result.usages[0].filePath).toBe(filePath);
        expect(result.usages[0].propertyChain).toEqual(["name"]);

        fs.rmSync(root, { recursive: true, force: true });
    });
});
