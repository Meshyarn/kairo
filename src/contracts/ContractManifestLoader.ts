import fs from "fs";
import path from "path";
import type { ContractManifest } from "../types/contract-manifest.js";
import { ContractManifestGenerator } from "./ContractManifestGenerator.js";
import { PathManager } from "../utils/PathManager.js";

export type ContractManifestLoadResult = {
  manifest?: ContractManifest;
  stale?: boolean;
  reason?: string;
};

export type ContractManifestLoadOptions = {
  autoGenerate?: boolean;
};

const normalizePackageName = (packageName: string) => packageName.replace(/\//g, "__");

export class ContractManifestLoader {
  constructor(private readonly rootPath: string = process.cwd()) {}

  public loadManifest(
    packageName: string,
    kind: string = "ffi_napi",
    options?: ContractManifestLoadOptions
  ): ContractManifestLoadResult {
    const manifestPath = this.resolveManifestPath(packageName, kind);
    if (!fs.existsSync(manifestPath)) {
      if (options?.autoGenerate) {
        const generated = this.generateFromPackage(packageName, kind);
        if (generated) {
          return { manifest: generated };
        }
      }
      return { reason: "contract_manifest_missing" };
    }

    let manifest: ContractManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch {
      if (options?.autoGenerate) {
        const generated = this.generateFromPackage(packageName, kind);
        if (generated) {
          return { manifest: generated };
        }
      }
      return { reason: "contract_manifest_invalid" };
    }

    if (!this.isValidManifest(manifest)) {
      if (options?.autoGenerate) {
        const generated = this.generateFromPackage(packageName, kind);
        if (generated) {
          return { manifest: generated };
        }
      }
      return { reason: "contract_manifest_invalid" };
    }

    const stale = this.isStale(packageName, manifestPath, manifest.header?.generatedAt);
    return { manifest, stale };
  }

  public resolveManifestPath(packageName: string, kind: string = "ffi_napi"): string {
    const encoded = normalizePackageName(packageName);
    return PathManager.resolveForRoot(this.rootPath, "contracts", kind, `${encoded}.json`);
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

    const direct = path.join(this.rootPath, "node_modules", packageName, "package.json");
    if (fs.existsSync(direct)) {
      return direct;
    }

    const linked = path.join(this.rootPath, "crates", "core-rs", "package.json");
    if (packageName === "@kairo/core-rs" && fs.existsSync(linked)) {
      return linked;
    }

    return undefined;
  }

  private resolvePackageRoot(packageName: string): string | undefined {
    const packageJsonPath = this.resolvePackageJsonPath(packageName);
    if (!packageJsonPath) return undefined;
    return path.dirname(packageJsonPath);
  }

  private generateFromPackage(packageName: string, kind: string): ContractManifest | undefined {
    const packageRoot = this.resolvePackageRoot(packageName);
    if (!packageRoot) return undefined;
    const packageJsonPath = path.join(packageRoot, "package.json");
    if (!fs.existsSync(packageJsonPath)) return undefined;

    let pkg: { types?: string; typings?: string; main?: string } | undefined;
    try {
      pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    } catch {
      return undefined;
    }

    const entry = this.resolvePackageEntry(packageRoot, pkg ?? {});
    if (!entry || !entry.endsWith(".d.ts")) {
      return undefined;
    }

    const generator = new ContractManifestGenerator();
    const sourceRepo = this.normalizeSourceRepo(packageRoot);
    const manifest = generator.generateFromDts(packageName, entry, { sourceRepo });
    generator.writeManifest(manifest, this.rootPath, kind);
    return manifest;
  }

  private normalizeSourceRepo(packageRoot: string): string {
    const relative = path.relative(this.rootPath, packageRoot);
    if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      return relative || ".";
    }
    return packageRoot;
  }

  private resolvePackageEntry(
    repoPath: string,
    pkg: { types?: string; typings?: string; main?: string }
  ): string | undefined {
    const candidates = [pkg.types, pkg.typings, pkg.main].filter(Boolean) as string[];
    for (const candidate of candidates) {
      const resolved = this.resolvePackageEntryCandidate(repoPath, candidate);
      if (resolved) return resolved;
    }
    return this.resolvePackageEntryCandidate(repoPath, "index");
  }

  private resolvePackageEntryCandidate(repoPath: string, candidate: string): string | undefined {
    const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(repoPath, candidate);
    if (fs.existsSync(absolute)) {
      const stat = fs.statSync(absolute);
      if (stat.isFile()) return absolute;
      if (stat.isDirectory()) {
        return this.resolvePackageEntryCandidate(absolute, "index");
      }
    }
    const extensions = [".d.ts", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
    for (const ext of extensions) {
      const resolved = `${absolute}${ext}`;
      if (fs.existsSync(resolved)) return resolved;
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
