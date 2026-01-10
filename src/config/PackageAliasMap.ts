import * as fs from "fs";
import * as path from "path";
import { RepoRegistry } from "./RepoRegistry.js";

export interface PackageAlias {
    packageName: string;
    repoId: string;
    repoPath: string;
    packageJson?: string;
    entryPath?: string;
}

export class PackageAliasMap {
    private aliases = new Map<string, PackageAlias>();

    constructor(private readonly repoRegistry: RepoRegistry) {}

    public build(): void {
        this.aliases.clear();
        for (const repo of this.repoRegistry.getAllRepos()) {
            const packageJsonPath = path.join(repo.path, "package.json");
            if (!fs.existsSync(packageJsonPath)) continue;

            let pkg: { name?: string; types?: string; typings?: string; main?: string } | undefined;
            try {
                pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
            } catch {
                continue;
            }
            if (!pkg?.name) continue;

            const entryPath = this.resolveEntryPath(repo.path, pkg);
            this.aliases.set(pkg.name, {
                packageName: pkg.name,
                repoId: repo.id,
                repoPath: repo.path,
                packageJson: packageJsonPath,
                entryPath
            });
        }
    }

    public resolve(specifier: string): PackageAlias | undefined {
        return this.aliases.get(specifier);
    }

    public findByRepoId(repoId: string): PackageAlias | undefined {
        for (const alias of this.aliases.values()) {
            if (alias.repoId === repoId) return alias;
        }
        return undefined;
    }

    public findByRepoPath(repoPath: string): PackageAlias | undefined {
        const normalized = path.resolve(repoPath);
        for (const alias of this.aliases.values()) {
            if (path.resolve(alias.repoPath) === normalized) return alias;
        }
        return undefined;
    }

    private resolveEntryPath(
        repoPath: string,
        pkg: { types?: string; typings?: string; main?: string }
    ): string | undefined {
        const candidates = [pkg.types, pkg.typings, pkg.main].filter(Boolean) as string[];
        for (const candidate of candidates) {
            const resolved = this.resolveCandidate(repoPath, candidate);
            if (resolved) return resolved;
        }
        return this.resolveCandidate(repoPath, "index");
    }

    private resolveCandidate(repoPath: string, candidate: string): string | undefined {
        const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(repoPath, candidate);
        const direct = this.resolveFilePath(absolute);
        if (direct) return direct;
        return undefined;
    }

    private resolveFilePath(basePath: string): string | undefined {
        if (fs.existsSync(basePath)) {
            const stat = fs.statSync(basePath);
            if (stat.isFile()) return basePath;
            if (stat.isDirectory()) {
                return this.resolveFilePath(path.join(basePath, "index"));
            }
        }

        const extensions = [".d.ts", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
        for (const ext of extensions) {
            const candidate = `${basePath}${ext}`;
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return undefined;
    }
}
