import fs from "fs";
import os from "os";
import path from "path";
import { ContractManifestGenerator } from "../../contracts/ContractManifestGenerator.js";

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "contract-gen-"));

describe("ContractManifestGenerator", () => {
    it("generates exports from d.ts", () => {
        const root = makeTempDir();
        const dtsPath = path.join(root, "index.d.ts");
        fs.writeFileSync(dtsPath, `
export interface ChunkResult {
  text: string;
  tokens: number[];
}

export declare class SmartChunker {
  chunk(text: string, maxTokens: number): Array<ChunkResult>;
}

export declare function tokenize(input: string): string[];
`, "utf-8");

        const generator = new ContractManifestGenerator();
        const manifest = generator.generateFromDts("@kairo/core-rs", dtsPath, {
            sourceRepo: "crates/core-rs",
            manifestRoot: root
        });

        expect(ContractManifestGenerator.validateManifest(manifest)).toBe(true);

        const exportsMap = (manifest.surface as any).exports;
        expect(exportsMap.ChunkResult).toBeDefined();
        expect(exportsMap.SmartChunker).toBeDefined();
        expect(exportsMap.tokenize).toBeDefined();

        const outputPath = generator.writeManifest(manifest, root);
        expect(fs.existsSync(outputPath)).toBe(true);

        fs.rmSync(root, { recursive: true, force: true });
    });
});
