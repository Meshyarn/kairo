import fs from "fs";
import path from "path";
import { ContractManifestLoader } from "../contracts/ContractManifestLoader.js";
import { ContractManifestGenerator } from "../contracts/ContractManifestGenerator.js";
import { PathManager } from "../utils/PathManager.js";
import type { ConfigFinding, ConfigWriteOp, RepoSummary } from "./ConfigBootstrapperTypes.js";

export const buildContractFindings = (rootPath: string, repos: RepoSummary[]): { findings: ConfigFinding[]; hints: string[] } => {
    const findings: ConfigFinding[] = [];
    const hints: string[] = [];
    const contractsDir = PathManager.resolveForRoot(rootPath, "contracts");
    if (!fs.existsSync(contractsDir)) {
        findings.push({
            code: "CONTRACTS_DIR_MISSING",
            severity: "warn",
            message: "Contracts directory is missing (<KAIRO_DIR>/contracts).",
            action: "init_contracts",
            evidence: { path: contractsDir }
        });
        hints.push(`Create ${contractsDir} or run a build step that generates contract manifests.`);
        return { findings, hints };
    }

    const entries = fs.readdirSync(contractsDir, { withFileTypes: true });
    const hasManifest = entries.some((entry) => entry.isDirectory() || entry.isFile());
    if (!hasManifest) {
        findings.push({
            code: "CONTRACTS_EMPTY",
            severity: "warn",
            message: "Contracts directory exists but no manifests were found.",
            action: "generate_contracts",
            evidence: { path: contractsDir }
        });
        hints.push("Generate contract manifests (e.g. NAPI d.ts manifest) to enable cross-language impact.");
    }

    const linkedRepos = repos.filter((repo) => repo.type === "linked");
    const manifestLoader = new ContractManifestLoader(rootPath);
    for (const repo of linkedRepos) {
        const repoPath = path.resolve(rootPath, repo.path);
        const packageJsonPath = path.join(repoPath, "package.json");
        if (!fs.existsSync(packageJsonPath)) {
            findings.push({
                code: "CONTRACT_ALIAS_MISSING",
                severity: "warn",
                message: `Linked repo "${repo.id}" is missing package.json; cannot map package alias.`,
                action: "add_package_name",
                evidence: { path: repoPath, repoId: repo.id }
            });
            hints.push(`Add package.json with name field in ${repoPath} to enable alias mapping.`);
            continue;
        }

        let pkg: { name?: string; types?: string; typings?: string; main?: string } | undefined;
        try {
            pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        } catch {
            findings.push({
                code: "CONTRACT_ALIAS_INVALID",
                severity: "warn",
                message: `Linked repo "${repo.id}" has invalid package.json; cannot map package alias.`,
                action: "fix_package_json",
                evidence: { path: packageJsonPath, repoId: repo.id }
            });
            continue;
        }

        if (!pkg?.name) {
            findings.push({
                code: "CONTRACT_ALIAS_INVALID",
                severity: "warn",
                message: `Linked repo "${repo.id}" package.json is missing name; cannot map package alias.`,
                action: "add_package_name",
                evidence: { path: packageJsonPath, repoId: repo.id }
            });
        }

        if (pkg?.name) {
            const manifestResult = manifestLoader.loadManifest(pkg.name, "ffi_napi");
            if (manifestResult.reason === "contract_manifest_missing") {
                findings.push({
                    code: "CONTRACT_MANIFEST_MISSING",
                    severity: "warn",
                    message: `Contract manifest for "${pkg.name}" not found.`,
                    action: "generate_contracts",
                    evidence: { packageName: pkg.name, repoId: repo.id }
                });
                hints.push(`Generate contract manifest for ${pkg.name} (e.g. run build in ${repoPath}).`);
            } else if (manifestResult.reason === "contract_manifest_invalid") {
                findings.push({
                    code: "CONTRACT_MANIFEST_INVALID",
                    severity: "warn",
                    message: `Contract manifest for "${pkg.name}" is invalid.`,
                    action: "regenerate_contracts",
                    evidence: { packageName: pkg.name, repoId: repo.id }
                });
                hints.push(`Regenerate contract manifest for ${pkg.name} to fix invalid schema.`);
            } else if (manifestResult.stale) {
                findings.push({
                    code: "CONTRACT_MANIFEST_STALE",
                    severity: "warn",
                    message: `Contract manifest for "${pkg.name}" is stale.`,
                    action: "regenerate_contracts",
                    evidence: { packageName: pkg.name, repoId: repo.id }
                });
                hints.push(`Regenerate contract manifest for ${pkg.name} to pick up recent changes.`);
            }
        }

        if (!pkg) {
            continue;
        }

        const entry = resolvePackageEntry(repoPath, pkg);
        if (!entry) {
            findings.push({
                code: "CONTRACT_ALIAS_ENTRY_MISSING",
                severity: "warn",
                message: `Linked repo "${repo.id}" has no resolvable entry file for alias mapping.`,
                action: "add_entry_file",
                evidence: { path: packageJsonPath, repoId: repo.id }
            });
            hints.push(`Add types/main or index.d.ts for ${repoPath} to enable cross-language alias mapping.`);
        }
    }

    return { findings, hints };
};

export const buildContractPlan = (rootPath: string, repos: RepoSummary[]): ConfigWriteOp[] => {
    const plan: ConfigWriteOp[] = [];
    const contractsDir = PathManager.resolveForRoot(rootPath, "contracts");
    const napiDir = path.join(contractsDir, "ffi_napi");
    if (!fs.existsSync(contractsDir)) {
        plan.push({
            op: "mkdir",
            path: contractsDir,
            reason: "Create contracts directory."
        });
    }
    if (!fs.existsSync(napiDir)) {
        plan.push({
            op: "mkdir",
            path: napiDir,
            reason: "Create NAPI contracts directory."
        });
    }

    const manifestLoader = new ContractManifestLoader(rootPath);
    const generator = new ContractManifestGenerator();
    const linkedRepos = repos.filter((repo) => repo.type === "linked");

    for (const repo of linkedRepos) {
        const repoPath = path.resolve(rootPath, repo.path);
        const packageJsonPath = path.join(repoPath, "package.json");
        if (!fs.existsSync(packageJsonPath)) continue;

        let pkg: { name?: string; types?: string; typings?: string; main?: string } | undefined;
        try {
            pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        } catch {
            continue;
        }
        if (!pkg?.name) continue;

        const entry = resolvePackageEntry(repoPath, pkg);
        if (!entry || !entry.endsWith(".d.ts") || !fs.existsSync(entry)) {
            continue;
        }

        const manifestPath = manifestLoader.resolveManifestPath(pkg.name, "ffi_napi");
        if (fs.existsSync(manifestPath)) {
            continue;
        }

        try {
            const manifest = generator.generateFromDts(pkg.name, entry, { sourceRepo: repo.path });
            plan.push({
                op: "create",
                path: manifestPath,
                content: JSON.stringify(manifest, null, 2),
                reason: `Generate contract manifest for ${pkg.name}.`
            });
        } catch {
            // ignore plan generation failures; doctor will surface findings
        }
    }

    return plan;
};

export const resolvePackageEntry = (
    repoPath: string,
    pkg: { types?: string; typings?: string; main?: string }
): string | undefined => {
    const candidates = [pkg.types, pkg.typings, pkg.main].filter(Boolean) as string[];
    for (const candidate of candidates) {
        const resolved = resolvePackageEntryCandidate(repoPath, candidate);
        if (resolved) return resolved;
    }
    return resolvePackageEntryCandidate(repoPath, "index");
};

export const resolvePackageEntryCandidate = (repoPath: string, candidate: string): string | undefined => {
    const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(repoPath, candidate);
    if (fs.existsSync(absolute)) {
        const stat = fs.statSync(absolute);
        if (stat.isFile()) return absolute;
        if (stat.isDirectory()) {
            return resolvePackageEntryCandidate(absolute, "index");
        }
    }
    const extensions = [".d.ts", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
    for (const ext of extensions) {
        const resolved = `${absolute}${ext}`;
        if (fs.existsSync(resolved)) return resolved;
    }
    return undefined;
};
