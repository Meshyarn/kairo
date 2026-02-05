import path from "path";
import type { InternalToolRegistry } from "../../InternalToolRegistry.js";
import type { OrchestrationContext } from "../../OrchestrationContext.js";
import type { IFileSystem } from "../../../platform/FileSystem.js";
import type { RepoRegistry } from "../../../config/RepoRegistry.js";
import type { PackageAliasMap } from "../../../config/PackageAliasMap.js";
import type { DependencyGraph } from "../../../ast/DependencyGraph.js";
import type { ImpactAnalyzer } from "../../../engine/ImpactAnalyzer.js";
import type { CrossLangImpact } from "../../../types/engine.js";
import { ContractManifestLoader } from "../../../contracts/ContractManifestLoader.js";
import { ContractManifestGenerator } from "../../../contracts/ContractManifestGenerator.js";
import { diffManifests } from "../../../contracts/ContractDiffer.js";
import { resolveSymbolicGuardConfig } from "../../../config/SymbolicGuardConfig.js";
import { PathManager } from "../../../utils/PathManager.js";
import { escapeRegExp } from "./ChangePillarImpactUtils.js";

export const buildCrossLangImpact = async (args: {
  targetPath: string;
  context: OrchestrationContext;
  registry: InternalToolRegistry;
  rootPath: string;
  fileSystem: IFileSystem;
  runTool: (context: OrchestrationContext, tool: string, toolArgs: any) => Promise<any>;
  options?: { force?: boolean; changedExports?: string[]; afterContent?: string };
}): Promise<CrossLangImpact | undefined> => {
  const repoRegistry = args.registry.getMetadata("repoRegistry") as RepoRegistry | undefined;
  const packageAliasMap = args.registry.getMetadata("packageAliasMap") as PackageAliasMap | undefined;
  const dependencyGraph = args.registry.getMetadata("dependencyGraph") as DependencyGraph | undefined;
  const impactAnalyzer = args.registry.getMetadata("impactAnalyzer") as ImpactAnalyzer | undefined;
  if (!repoRegistry || !packageAliasMap || !dependencyGraph) {
    return undefined;
  }

  const repo = repoRegistry.findRepoByPath(args.targetPath);
  if (!repo) return undefined;
  const alias = packageAliasMap.findByRepoId(repo.id) ?? packageAliasMap.findByRepoPath(repo.path);
  if (!alias?.packageName || !alias.entryPath) {
    return undefined;
  }

  const manifestLoader = new ContractManifestLoader(args.rootPath);
  const guardConfig = resolveSymbolicGuardConfig();
  const contractMode = guardConfig.contractGuard.mode;
  const allowConsumerScan = contractMode === "spec_plus_consumer_scan" && guardConfig.contractGuard.consumerScan.enabled;
  const maxConsumerFiles = guardConfig.contractGuard.consumerScan.maxFiles;
  const consumerLimit = Number.isFinite(maxConsumerFiles) && maxConsumerFiles > 0
    ? Math.floor(maxConsumerFiles)
    : undefined;
  const loadResult = manifestLoader.loadManifest(alias.packageName, "ffi_napi", {
    autoGenerate: true
  });
  const beforeManifest = loadResult.manifest;

  let afterManifest = beforeManifest;
  if (alias.entryPath.endsWith(".d.ts")) {
    if (await args.fileSystem.exists(alias.entryPath)) {
      const generator = new ContractManifestGenerator();
      const useOverride = typeof args.options?.afterContent === "string"
        && path.resolve(alias.entryPath) === path.resolve(args.targetPath);
      afterManifest = useOverride
        ? generator.generateFromDtsContent(alias.packageName, alias.entryPath, args.options!.afterContent as string, {
          sourceRepo: repo.path
        })
        : generator.generateFromDts(alias.packageName, alias.entryPath, {
          sourceRepo: repo.path
        });
    }
  }

  let diff = diffManifests(beforeManifest, afterManifest);
  if (loadResult.reason || loadResult.stale) {
    const extra = [];
    if (loadResult.reason) extra.push(loadResult.reason);
    if (loadResult.stale) extra.push("contract_manifest_stale");
    diff = {
      ...diff,
      degraded: true,
      reasons: Array.from(new Set([...(diff.reasons ?? []), ...extra]))
    };
  }

  const forcedExports = Array.isArray(args.options?.changedExports)
    ? args.options?.changedExports.filter((name) => typeof name === "string" && name.length > 0)
    : [];
  const forceImpact = Boolean(args.options?.force);
  const hasOriginalChanges = diff.added.length + diff.removed.length + diff.changed.length > 0;
  if (forceImpact && forcedExports.length > 0) {
    const known = new Set([...diff.added, ...diff.removed, ...diff.changed.map((entry) => entry.exportName)]);
    const extraChanges = forcedExports.filter((name) => !known.has(name));
    if (extraChanges.length > 0) {
      diff = {
        ...diff,
        changed: [
          ...diff.changed,
          ...extraChanges.map((name) => ({
            exportName: name,
            kind: "unknown" as const,
            before: null,
            after: null,
            breaking: true
          }))
        ]
      };
    }
  }
  if (forceImpact && !hasOriginalChanges && !diff.degraded) {
    diff = {
      ...diff,
      degraded: true,
      reasons: Array.from(new Set([...(diff.reasons ?? []), "contract_manifest_stale"]))
    };
  }

  const breakingExports = Array.from(new Set([
    ...diff.removed,
    ...diff.changed.filter((entry) => entry.breaking).map((entry) => entry.exportName)
  ]));
  const nonBreakingExports = Array.from(new Set([
    ...diff.added,
    ...diff.changed.filter((entry) => !entry.breaking).map((entry) => entry.exportName)
  ]));
  const hasChanges = diff.added.length + diff.removed.length + diff.changed.length > 0;
  const hasBreaking = breakingExports.length > 0;
  const hasOnlyAdditions = diff.added.length > 0 && !hasBreaking;
  if (!diff.degraded && !hasChanges) {
    return undefined;
  }
  if (!diff.degraded && hasOnlyAdditions) {
    diff = {
      ...diff,
      degraded: true,
      reasons: Array.from(new Set([...(diff.reasons ?? []), "contract_non_breaking_change"]))
    };
  }

  const importers = await dependencyGraph.getImporters(alias.entryPath);
  let consumerFiles = importers.map((edge) => edge.from).filter(Boolean);
  let usedFallback = false;
  let consumerCapped = false;
  if (consumerFiles.length === 0 && allowConsumerScan) {
    const fallback = await findFallbackConsumers({
      context: args.context,
      packageName: alias.packageName,
      entryPath: alias.entryPath,
      runTool: args.runTool,
      fileSystem: args.fileSystem
    });
    if (fallback.length > 0) {
      consumerFiles = fallback;
      usedFallback = true;
    }
  }
  if (allowConsumerScan && consumerLimit && consumerFiles.length > consumerLimit) {
    consumerFiles = consumerFiles.slice(0, consumerLimit);
    consumerCapped = true;
  }

  if (impactAnalyzer && allowConsumerScan) {
    const enriched = await impactAnalyzer.analyzeCrossLangImpact(alias.packageName, alias.entryPath, diff, {
      maxConsumerFiles: consumerLimit
    });
    if (consumerFiles.length > 0 && enriched.consumerFiles.length === 0) {
      enriched.consumerFiles = consumerFiles;
    }
    if (usedFallback) {
      enriched.degraded = true;
      enriched.reasons = Array.from(new Set([...(enriched.reasons ?? []), "cross_lang_contract_degraded"]));
    }
    if (consumerCapped) {
      enriched.degraded = true;
      enriched.reasons = Array.from(new Set([...(enriched.reasons ?? []), "contract_consumer_scan_capped"]));
    }
    return enriched;
  }
  const changedExports = [
    ...diff.added,
    ...diff.removed,
    ...diff.changed.map((entry) => entry.exportName)
  ];

  return {
    packageName: alias.packageName,
    consumerFiles: Array.from(new Set(consumerFiles)),
    changedExports: Array.from(new Set(changedExports)),
    breakingExports: breakingExports.length > 0 ? breakingExports : undefined,
    nonBreakingExports: nonBreakingExports.length > 0 ? nonBreakingExports : undefined,
    degraded: diff.degraded || usedFallback || consumerCapped,
    reasons: Array.from(new Set([
      ...(diff.reasons ?? []),
      ...(usedFallback ? ["cross_lang_contract_degraded"] : []),
      ...(consumerCapped ? ["contract_consumer_scan_capped"] : [])
    ]))
  };
};

export const findFallbackConsumers = async (args: {
  context: OrchestrationContext;
  packageName: string;
  entryPath: string;
  runTool: (context: OrchestrationContext, tool: string, toolArgs: any) => Promise<any>;
  fileSystem: IFileSystem;
}): Promise<string[]> => {
  try {
    const result = await args.runTool(args.context, "project_search", {
      query: args.packageName,
      maxResults: 80,
      type: "file"
    });
    const paths = Array.isArray(result?.results)
      ? result.results.map((item: any) => item.path).filter((p: any) => typeof p === "string")
      : [];
    const unique = new Set<string>();
    const importPattern = new RegExp(
      String.raw`(?:from\s+["']${escapeRegExp(args.packageName)}["']|require\(\s*["']${escapeRegExp(args.packageName)}["']\s*\)|import\(\s*["']${escapeRegExp(args.packageName)}["']\s*\))`
    );
    const baseDir = PathManager.getBaseDir()
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .replace(/^\.\//, "");
    const hasCustomBase = baseDir && !path.isAbsolute(baseDir);
    for (const filePath of paths) {
      if (!filePath || filePath === args.entryPath) continue;
      const normalized = filePath.replace(/\\/g, "/");
      if (normalized.includes("/.kairo/") || normalized.includes("/node_modules/")) continue;
      if (hasCustomBase && normalized.includes(`/${baseDir}/`)) continue;
      if (!/\.(ts|tsx|js|jsx)$/.test(filePath)) continue;
      try {
        const content = await args.fileSystem.readFile(filePath);
        if (!importPattern.test(content)) continue;
      } catch {
        continue;
      }
      unique.add(filePath);
    }
    return Array.from(unique);
  } catch {
    return [];
  }
};
