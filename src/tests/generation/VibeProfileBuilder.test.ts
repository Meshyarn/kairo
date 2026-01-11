import { describe, it, expect } from "@jest/globals";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { NodeFileSystem } from "../../platform/FileSystem.js";
import { VibeProfileBuilder } from "../../generation/vibe-profile-builder.js";

describe("VibeProfileBuilder", () => {
    it("builds a StylePack with code style, patterns, and norms", async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kairo-style-"));
        try {
            const srcDir = path.join(tempDir, "src");
            await fs.mkdir(srcDir, { recursive: true });
            await fs.writeFile(path.join(srcDir, "a.ts"), "export const foo = 1;\n");
            await fs.writeFile(path.join(srcDir, "b.ts"), "export function bar() { return foo; }\n");
            await fs.writeFile(path.join(tempDir, "README.md"), "You must add tests for new features.\n");

            const fileSystem = new NodeFileSystem(tempDir);
            const builder = new VibeProfileBuilder(fileSystem, tempDir, { includeNorms: true });
            const pack = await builder.build("src/a.ts");

            expect(pack.profile.codeStyle.indent).toBeDefined();
            expect(pack.profile.patterns.fileOrg.fileNamePattern).toBeDefined();
            expect(pack.profile.norms?.length).toBeGreaterThan(0);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });
});
