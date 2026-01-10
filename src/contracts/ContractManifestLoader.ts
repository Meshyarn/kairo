import fs from "fs";
import path from "path";
import type { ContractManifest } from "../types/contract-manifest.js";

export type ContractManifestLoadResult = {
  manifest?: ContractManifest;
  stale?: boolean;
  reason?: string;
};

const normalizePackageName = (packageName: string) => packageName.replace(/\//g, "__");

export class ContractManifestLoader {
  constructor(private readonly rootPath: string = process.cwd()) {}

  public loadManifest(packageName: string, kind: string = "ffi_napi"): ContractManifestLoadResult {
    const manifestPath = this.resolveManifestPath(packageName, kind);
    if (!fs.existsSync(manifestPath)) {
      return { reason: "contract_manifest_missing" };
    }

    let manifest: ContractManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch {
      return { reason: "contract_manifest_invalid" };
    }

    if (!this.isValidManifest(manifest)) {
      return { reason: "contract_manifest_invalid" };
    }

    const stale = this.isStale(packageName, manifestPath, manifest.header?.generatedAt);
    return { manifest, stale };
  }

  public resolveManifestPath(packageName: string, kind: string = "ffi_napi"): string {
    const encoded = normalizePackageName(packageName);
    return path.join(this.rootPath, ".kairo", "contracts", kind, `${encoded}.json`);
  }

  private isStale(packageName: string, manifestPath: string, generatedAt?: number): boolean {
    if (!generatedAt) return false;
    const packageJsonPath = this.resolvePackageJsonPath(packageName);
    if (!packageJsonPath || !fs.existsSync(packageJsonPath)) return false;

    try {
      const manifestMtime = fs.statSync(manifestPath).mtimeMs;
      const pkgMtime = fs.statSync(packageJsonPath).mtimeMs;
      return pkgMtime > generatedAt || pkgMtime > manifestMtime;
    } catch {
      return false;
    }
  }

  private resolvePackageJsonPath(packageName: string): string | undefined {
    const rootPackageJson = path.join(this.rootPath, "package.json");
    if (fs.existsSync(rootPackageJson)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(rootPackageJson, "utf-8"));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
        if (deps && deps[packageName]) {
          const resolved = path.join(this.rootPath, "node_modules", packageName, "package.json");
          if (fs.existsSync(resolved)) return resolved;
        }
      } catch {
        // ignore
      }
    }

    const linked = path.join(this.rootPath, "crates", "core-rs", "package.json");
    if (packageName === "@kairo/core-rs" && fs.existsSync(linked)) {
      return linked;
    }

    return undefined;
  }

  private isValidManifest(manifest: ContractManifest): boolean {
    if (!manifest?.header || !manifest?.surface) return false;
    if (manifest.header.version !== "1.0") return false;
    if (!manifest.header.kind) return false;
    if (!manifest.header.id) return false;
    return true;
  }
}
