import fs from "fs";
import os from "os";
import path from "path";
import { ContractManifestLoader } from "../../contracts/ContractManifestLoader.js";

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "contract-loader-"));

describe("ContractManifestLoader", () => {
    it("loads a manifest when present", () => {
        const root = makeTempDir();
        const manifestDir = path.join(root, ".kairo", "contracts", "ffi_napi");
        fs.mkdirSync(manifestDir, { recursive: true });
        const manifestPath = path.join(manifestDir, "@kairo__core-rs.json");
        fs.writeFileSync(manifestPath, JSON.stringify({
            header: {
                version: "1.0",
                kind: "ffi_napi",
                id: "@kairo__core-rs",
                module: "@kairo/core-rs",
                sourceRepo: "crates/core-rs",
                generatedAt: Date.now()
            },
            surface: { kind: "ffi_napi", exports: {} }
        }, null, 2));

        const loader = new ContractManifestLoader(root);
        const result = loader.loadManifest("@kairo/core-rs");
        expect(result.manifest?.header?.module).toBe("@kairo/core-rs");

        fs.rmSync(root, { recursive: true, force: true });
    });

    it("returns a missing reason when manifest is absent", () => {
        const root = makeTempDir();
        const loader = new ContractManifestLoader(root);
        const result = loader.loadManifest("@kairo/core-rs");
        expect(result.reason).toBe("contract_manifest_missing");
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("auto-generates a manifest when types are available", () => {
        const root = makeTempDir();
        const packageDir = path.join(root, "node_modules", "@kairo", "core-rs");
        fs.mkdirSync(packageDir, { recursive: true });
        fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({
            name: "@kairo/core-rs",
            types: "index.d.ts"
        }, null, 2));
        fs.writeFileSync(path.join(packageDir, "index.d.ts"), "export interface ChunkResult { text: string; }\n");

        const loader = new ContractManifestLoader(root);
        const result = loader.loadManifest("@kairo/core-rs", "ffi_napi", { autoGenerate: true });
        expect(result.manifest?.header?.module).toBe("@kairo/core-rs");
        const manifestPath = path.join(root, ".kairo", "contracts", "ffi_napi", "@kairo__core-rs.json");
        expect(fs.existsSync(manifestPath)).toBe(true);

        fs.rmSync(root, { recursive: true, force: true });
    });

    it("returns an invalid reason for malformed manifest", () => {
        const root = makeTempDir();
        const manifestDir = path.join(root, ".kairo", "contracts", "ffi_napi");
        fs.mkdirSync(manifestDir, { recursive: true });
        fs.writeFileSync(path.join(manifestDir, "@kairo__core-rs.json"), "{not valid json", "utf-8");

        const loader = new ContractManifestLoader(root);
        const result = loader.loadManifest("@kairo/core-rs");
        expect(result.reason).toBe("contract_manifest_invalid");

        fs.rmSync(root, { recursive: true, force: true });
    });

    it("flags stale manifests when package.json is newer", () => {
        const root = makeTempDir();
        const manifestDir = path.join(root, ".kairo", "contracts", "ffi_napi");
        fs.mkdirSync(manifestDir, { recursive: true });
        const manifestPath = path.join(manifestDir, "@kairo__core-rs.json");
        fs.writeFileSync(manifestPath, JSON.stringify({
            header: {
                version: "1.0",
                kind: "ffi_napi",
                id: "@kairo__core-rs",
                module: "@kairo/core-rs",
                sourceRepo: "crates/core-rs",
                generatedAt: 1
            },
            surface: { kind: "ffi_napi", exports: {} }
        }, null, 2));

        const packageDir = path.join(root, "crates", "core-rs");
        fs.mkdirSync(packageDir, { recursive: true });
        fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({ name: "@kairo/core-rs" }, null, 2));

        const loader = new ContractManifestLoader(root);
        const result = loader.loadManifest("@kairo/core-rs");
        expect(result.stale).toBe(true);

        fs.rmSync(root, { recursive: true, force: true });
    });
});
