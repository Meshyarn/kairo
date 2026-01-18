import * as path from "path";
import type { IndexDatabase } from "../indexing/IndexDatabase.js";
import type { IFileSystem } from "../platform/FileSystem.js";

type ServiceRootConfidence = "high" | "medium" | "low";

export type ServiceRootSignal = {
    root: string;
    signals: string[];
    confidence: ServiceRootConfidence;
};

const WORKSPACE_MANIFESTS = new Set([
    "pnpm-workspace.yaml",
    "nx.json",
    "turbo.json"
]);

const MANIFEST_FILES = new Set([
    "package.json",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
    "pyproject.toml",
    "requirements.txt",
    "composer.json",
    "next.config.js",
    "next.config.ts",
    "next.config.mjs",
    "next.config.cjs"
]);

const IGNORE_SEGMENTS = ["/node_modules/", "/.git/", "/dist/", "/build/", "/vendor/"];

function normalizePath(relPath: string): string {
    return relPath.split(path.sep).join("/");
}

function isIgnoredRoot(relRoot: string): boolean {
    const normalized = `/${normalizePath(relRoot)}/`;
    return IGNORE_SEGMENTS.some(segment => normalized.includes(segment));
}

function toRoot(relPath: string): string {
    const normalized = normalizePath(relPath);
    const dir = path.posix.dirname(normalized);
    return dir === "." ? "" : dir;
}

function resolveConfidence(signalCount: number): ServiceRootConfidence {
    if (signalCount >= 3) return "high";
    if (signalCount >= 2) return "medium";
    return "low";
}

type ManualScopesFileV1 = {
    version: "1";
    scopes: Array<{
        id?: string;
        root: string;
        kind?: "serviceRoot";
        confidence?: ServiceRootConfidence;
    }>;
};

async function loadManualServiceRoots(args: { rootPath: string; fileSystem: IFileSystem }): Promise<ServiceRootSignal[]> {
    const configPath = ".kairo/config/scopes.json";
    try {
        const raw = await args.fileSystem.readFile(configPath);
        const parsed = JSON.parse(raw) as ManualScopesFileV1;
        if (!parsed || parsed.version !== "1" || !Array.isArray(parsed.scopes)) return [];
        return parsed.scopes
            .filter(scope => scope && typeof scope.root === "string" && scope.root.trim().length > 0)
            .map(scope => ({
                root: path.resolve(args.rootPath, scope.root),
                confidence: scope.confidence ?? "high",
                signals: ["manual_scope"]
            }));
    } catch {
        return [];
    }
}

export async function detectServiceRoots(args: {
    rootPath: string;
    indexDatabase: IndexDatabase;
    fileSystem: IFileSystem;
}): Promise<ServiceRootSignal[]> {
    const manual = await loadManualServiceRoots({ rootPath: args.rootPath, fileSystem: args.fileSystem });
    const manifestSignals = new Map<string, Set<string>>();
    const execSignals = new Map<string, Set<string>>();
    const records = args.indexDatabase.listFiles();

    for (const record of records) {
        const normalized = normalizePath(record.path);
        const base = path.posix.basename(normalized);
        const root = toRoot(normalized);

        if (MANIFEST_FILES.has(base)) {
            if (!WORKSPACE_MANIFESTS.has(base)) {
                const bucket = manifestSignals.get(root) ?? new Set<string>();
                bucket.add(`manifest:${base}`);
                manifestSignals.set(root, bucket);
            }
        }

        if (normalized.includes("/src/main.") || normalized.includes("/src/index.")) {
            const rootFromSrc = normalized.split("/src/")[0];
            const bucket = execSignals.get(rootFromSrc) ?? new Set<string>();
            bucket.add("entry_src");
            execSignals.set(rootFromSrc, bucket);
        } else {
            const match = normalized.match(/^(.*)\/(app|server)\//);
            if (match?.[1] !== undefined) {
                const rootFromDir = match[1];
                const bucket = execSignals.get(rootFromDir) ?? new Set<string>();
                bucket.add("entry_dir");
                execSignals.set(rootFromDir, bucket);
            }
        }

        if (base === "package.json") {
            try {
                const content = await args.fileSystem.readFile(record.path);
                const parsed = JSON.parse(content);
                const scripts = parsed?.scripts ?? {};
                if (scripts?.start || scripts?.build) {
                    const bucket = execSignals.get(root) ?? new Set<string>();
                    bucket.add("package_scripts");
                    execSignals.set(root, bucket);
                }
            } catch {
                // ignore malformed package.json
            }
        }
    }

    const results: ServiceRootSignal[] = [];
    for (const [root, manifests] of manifestSignals.entries()) {
        if (isIgnoredRoot(root)) continue;
        const exec = execSignals.get(root) ?? new Set<string>();
        const signals = new Set<string>([...manifests, ...exec]);
        if (signals.size < 2) continue;
        results.push({
            root: path.join(args.rootPath, root),
            signals: Array.from(signals.values()),
            confidence: resolveConfidence(signals.size)
        });
    }

    const dedup = new Map<string, ServiceRootSignal>();
    for (const entry of [...manual, ...results]) {
        if (!entry?.root) continue;
        if (!dedup.has(entry.root)) {
            dedup.set(entry.root, entry);
        }
    }
    return Array.from(dedup.values());
}
