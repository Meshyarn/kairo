import * as path from "path";
import { createHash } from "crypto";
import { metrics } from "../../utils/MetricsCollector.js";
import { PathManager } from "../../utils/PathManager.js";
import { detectServiceRoots } from "../../utils/ServiceRootDetector.js";
import { hashContent } from "../../utils/hash.js";
import type { HandlerContext } from "../HandlerContext.js";
import { parseNumberEnv } from "./ManageStatusEnv.js";

export const buildWorkspaceDrift = async (context: HandlerContext, options?: { maxFiles?: number }) => {
    const maxFiles = options?.maxFiles ?? parseNumberEnv(process.env.KAIRO_DRIFT_CHECK_MAX_FILES, 200);
    const records = context.indexDatabase.listFiles();
    if (!records.length) {
        return {
            workspaceDrift: "unknown",
            scopes: [],
            checkedFiles: 0,
            mismatchedFiles: 0
        };
    }
    const workspaceScopeId = `workspace:${createHash("sha1").update(context.rootPath).digest("hex").slice(0, 8)}`;
    type ScopeStat = {
        scopeId: string;
        root: string;
        kind: "workspaceRoot" | "repoRoot" | "serviceRoot";
        repoId?: string;
        checkedFiles: number;
        mismatchedFiles: number;
        untrackedFiles: number;
        hashMismatches: number;
        maxModified: number;
        mismatchedPaths: string[];
        untrackedPaths: string[];
        signals: Set<string>;
        scopeConfidence: "high" | "medium" | "low" | "unknown";
    };
    const scopeStats = new Map<string, ScopeStat>();

    const indexSnapshot = context.indexStateManager
        ? await context.indexStateManager.getSnapshot().catch(() => undefined)
        : undefined;
    const serviceRoots = await detectServiceRoots({
        rootPath: context.rootPath,
        indexDatabase: context.indexDatabase,
        fileSystem: context.fileSystem
    });
    const sortedServiceRoots = serviceRoots.sort((a, b) => b.root.length - a.root.length);

    const resolveRelativePath = (inputPath: string) => context.pathNormalizer.normalize(inputPath);
    const resolveAbsolutePath = (inputPath: string) => context.pathNormalizer.toAbsolute(resolveRelativePath(inputPath));

    const shouldIgnoreRelative = (relativePath: string) => {
        if (!relativePath || relativePath.startsWith("..")) return true;
        const normalized = relativePath.split(path.sep).join("/");
        const ignoredRoots = new Set([".mcp", ".kairo", ".kairo-index"]);
        const baseDir = PathManager.getBaseDir()
            .replace(/\\/g, "/")
            .replace(/\/+$/, "")
            .replace(/^\.\//, "");
        if (baseDir && !path.isAbsolute(baseDir)) {
            const root = baseDir.split("/")[0];
            if (root) {
                ignoredRoots.add(root);
            }
        }
        if (Array.from(ignoredRoots).some(root => normalized === root || normalized.startsWith(`${root}/`))) {
            return true;
        }
        return context.symbolIndex.shouldIgnore(relativePath);
    };

    const isSupportedPath = (absolutePath: string) => {
        if (context.symbolIndex.isSupported(absolutePath)) return true;
        return context.documentIndexer?.isSupported(absolutePath) ?? false;
    };

    const getScope = (absPath: string) => {
        for (const serviceRoot of sortedServiceRoots) {
            if (absPath === serviceRoot.root || absPath.startsWith(`${serviceRoot.root}${path.sep}`)) {
                const scopeId = `service:${createHash("sha1").update(serviceRoot.root).digest("hex").slice(0, 8)}`;
                const existing = scopeStats.get(scopeId);
                if (existing) return existing;
                const created: ScopeStat = {
                    scopeId,
                    root: serviceRoot.root,
                    kind: "serviceRoot" as const,
                    checkedFiles: 0,
                    mismatchedFiles: 0,
                    untrackedFiles: 0,
                    hashMismatches: 0,
                    maxModified: 0,
                    mismatchedPaths: [],
                    untrackedPaths: [],
                    signals: new Set(),
                    scopeConfidence: serviceRoot.confidence
                };
                scopeStats.set(scopeId, created);
                return created;
            }
        }
        const repo = context.repoRegistry?.findRepoByPath?.(absPath);
        if (repo) {
            const scopeId = `repo:${repo.id}`;
            const existing = scopeStats.get(scopeId);
            if (existing) return existing;
            const created: ScopeStat = {
                scopeId,
                root: repo.path,
                kind: "repoRoot" as const,
                repoId: repo.id,
                checkedFiles: 0,
                mismatchedFiles: 0,
                untrackedFiles: 0,
                hashMismatches: 0,
                maxModified: 0,
                mismatchedPaths: [],
                untrackedPaths: [],
                signals: new Set(),
                scopeConfidence: "low"
            };
            scopeStats.set(scopeId, created);
            return created;
        }
        const existing = scopeStats.get(workspaceScopeId);
        if (existing) return existing;
        const created: ScopeStat = {
            scopeId: workspaceScopeId,
            root: context.rootPath,
            kind: "workspaceRoot" as const,
            checkedFiles: 0,
            mismatchedFiles: 0,
            untrackedFiles: 0,
            hashMismatches: 0,
            maxModified: 0,
            mismatchedPaths: [],
            untrackedPaths: [],
            signals: new Set(),
            scopeConfidence: "unknown"
        };
        scopeStats.set(workspaceScopeId, created);
        return created;
    };

    let checked = 0;
    let mismatched = 0;
    for (const record of records) {
        if (checked >= maxFiles) break;
        const absPath = resolveAbsolutePath(record.path);
        const relativePath = resolveRelativePath(record.path);
        if (shouldIgnoreRelative(relativePath)) {
            continue;
        }
        const scope = getScope(absPath);
        let isMismatched = false;
        try {
            const stat = await context.fileSystem.stat(absPath);
            if (stat.mtime > (record.last_modified ?? 0)) {
                isMismatched = true;
                scope.signals.add("mtime_changed");
            }
            scope.maxModified = Math.max(scope.maxModified, stat.mtime);
            if (record.content_hash) {
                const currentContent = await context.fileSystem.readFile(absPath);
                const currentHash = hashContent(currentContent);
                if (currentHash !== record.content_hash) {
                    scope.hashMismatches += 1;
                    isMismatched = true;
                    scope.signals.add("hash_mismatch");
                }
            }
        } catch {
            isMismatched = true;
            scope.signals.add("mtime_changed");
        }
        scope.checkedFiles += 1;
        checked += 1;
        if (isMismatched) {
            scope.mismatchedFiles += 1;
            mismatched += 1;
            if (scope.mismatchedPaths.length < 20) {
                scope.mismatchedPaths.push(relativePath);
            }
        }
    }

    const untrackedLimit = maxFiles;
    const pendingDirs = [context.rootPath];
    let scanned = 0;
    while (pendingDirs.length > 0 && scanned < untrackedLimit) {
        const dir = pendingDirs.pop()!;
        let entries: string[];
        try {
            entries = await context.fileSystem.readDir(dir);
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (scanned >= untrackedLimit) break;
            const absPath = path.join(dir, entry);
            const relativePath = path.relative(context.rootPath, absPath);
            if (shouldIgnoreRelative(relativePath)) {
                continue;
            }
            let stats: { isDirectory: () => boolean } | undefined;
            try {
                stats = await context.fileSystem.stat(absPath);
            } catch {
                continue;
            }
            if (stats.isDirectory()) {
                pendingDirs.push(absPath);
                continue;
            }
            if (!isSupportedPath(absPath)) continue;
            scanned += 1;
            const record = context.indexDatabase.getFile(relativePath);
            if (!record) {
                const scope = getScope(absPath);
                scope.untrackedFiles += 1;
                scope.signals.add("untracked_write");
                if (scope.untrackedPaths.length < 20) {
                    scope.untrackedPaths.push(relativePath);
                }
            }
        }
    }

    metrics.gauge("drift.checked_files", checked);
    metrics.gauge("drift.mismatched_files", mismatched);
    metrics.inc(mismatched > 0 ? "drift.detected" : "drift.clean");

    const scopes = Array.from(scopeStats.values()).map(entry => {
        const drift = entry.checkedFiles === 0 ? "unknown" : (entry.mismatchedFiles > 0 ? "detected" : "clean");
        if (indexSnapshot && (entry.maxModified > indexSnapshot.indexedAt || indexSnapshot.dirtyFileCount > 0)) {
            entry.signals.add("index_revision_mismatch");
        }
        if (entry.untrackedFiles > 0) {
            entry.signals.add("untracked_write");
        }
        return {
            scopeId: entry.scopeId,
            root: entry.root,
            kind: entry.kind,
            ...(entry.repoId ? { repoId: entry.repoId } : {}),
            drift,
            signals: Array.from(entry.signals.values()),
            affectedPathsCount: entry.mismatchedFiles + entry.untrackedFiles,
            indexStaleRatio: entry.checkedFiles > 0 ? entry.mismatchedFiles / entry.checkedFiles : undefined,
            ...(entry.mismatchedPaths.length > 0 ? { samplePaths: entry.mismatchedPaths } : {}),
            ...(entry.untrackedPaths.length > 0 ? { untrackedPaths: entry.untrackedPaths } : {}),
            scopeConfidence: entry.scopeConfidence
        };
    }).sort((a, b) => (b.affectedPathsCount ?? 0) - (a.affectedPathsCount ?? 0));

    const workspaceDrift = checked === 0 ? "unknown" : (mismatched > 0 ? "detected" : "clean");
    const targetPaths = scopes.flatMap(scope => (scope as any).samplePaths ?? []).slice(0, 50);
    const repairActions = mismatched > 0
        ? [
            ...(targetPaths.length > 0
                ? [{
                    tool: "manage",
                    args: { command: "reindex", paths: targetPaths },
                    tags: ["repair_ladder", "attempt_2"]
                }]
                : []),
            {
                tool: "manage",
                args: { command: "reindex" },
                tags: ["repair_ladder", "attempt_3"]
            }
        ]
        : [];
    return {
        workspaceDrift,
        scopes,
        checkedFiles: checked,
        mismatchedFiles: mismatched,
        ...(records.length > checked ? { sampled: true, totalFiles: records.length } : {}),
        ...(repairActions.length > 0 ? { repairActions } : {})
    };
};
