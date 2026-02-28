import type { BoundaryAdapterRegistry } from "../../contracts/BoundaryAdapterRegistry.js";
import type { BoundaryKind, BoundaryInstance } from "../../contracts/boundaries/types.js";
import type { RepoRegistry } from "../../config/RepoRegistry.js";
import type { PathNormalizer } from "../../utils/PathNormalizer.js";
import type { NormalizedRepoScope } from "../../utils/RepoScope.js";
import { isRepoIdInScope } from "../../utils/RepoScope.js";
import type { GraphRagConfig } from "../../config/GraphRagConfig.js";
import { resolveCrossBoundaryCaps } from "../../config/GraphRagConfig.js";
import type { ClusterSearchResponse } from "../../types/cluster.js";
import { ExpansionState, type ClusterSummary, type RelatedSymbol } from "../../types/cluster.js";

export type BoundaryEvidenceCache = {
    builtAt: number;
    byPath: Map<string, Set<BoundaryKind>>;
    byRepoPair: Map<string, Set<BoundaryKind>>;
};

export type BoundaryEvidenceDeps = {
    boundaryAdapterRegistry?: BoundaryAdapterRegistry;
    repoRegistry?: RepoRegistry;
    pathNormalizer?: PathNormalizer;
    rootPath?: string;
    cache?: BoundaryEvidenceCache | null;
    setCache?: (cache: BoundaryEvidenceCache | null) => void;
};

export const getBoundaryEvidence = async (deps: BoundaryEvidenceDeps): Promise<BoundaryEvidenceCache | null> => {
    if (deps.cache) {
        return deps.cache;
    }

    const boundaryRegistry = deps.boundaryAdapterRegistry;
    const repoRegistry = deps.repoRegistry;
    const pathNormalizer = deps.pathNormalizer;
    const rootPath = deps.rootPath;
    if (!boundaryRegistry || !repoRegistry || !pathNormalizer || !rootPath) {
        return null;
    }

    const cache = await buildBoundaryEvidence(rootPath, boundaryRegistry, repoRegistry, pathNormalizer);
    if (cache && deps.setCache) {
        deps.setCache(cache);
    }
    return cache;
};

export const applyCrossBoundaryPolicy = (args: {
    cluster: ClusterSearchResponse["clusters"][number];
    config: GraphRagConfig;
    projectFileCount?: number;
    degradedReasons: string[];
    boundaryEvidence: BoundaryEvidenceCache | null;
    policy: { repoScope: NormalizedRepoScope | null; allowCrossRepoEdits?: boolean };
    repoRegistry?: RepoRegistry;
    pathNormalizer?: PathNormalizer;
}): ClusterSummary["crossBoundary"] | undefined => {
    const repoRegistry = args.repoRegistry;
    const pathNormalizer = args.pathNormalizer;
    if (!repoRegistry || !pathNormalizer) {
        return undefined;
    }
    const seedFile = args.cluster.seeds[0]?.filePath;
    if (!seedFile || !args.cluster.related.dependency) {
        return undefined;
    }
    const seedAbsolute = toPathKey(seedFile, pathNormalizer);
    const seedRepo = repoRegistry.findRepoByPath(seedAbsolute);
    if (!seedRepo) {
        return undefined;
    }

    const container = args.cluster.related.dependency;
    const originalData = container.data ?? [];
    if (originalData.length === 0) {
        return undefined;
    }

    const allowlist = new Set(args.config.crossBoundary.allowlist ?? []);
    const repoScope = args.policy.repoScope;
    const sameRepo: RelatedSymbol[] = [];
    const crossRepo: RelatedSymbol[] = [];
    const blocked: RelatedSymbol[] = [];
    const kindCounts = new Map<string, number>();

    for (const symbol of originalData) {
        const absolute = toPathKey(symbol.filePath, pathNormalizer);
        const repo = repoRegistry.findRepoByPath(absolute);
        if (!repo || repo.id === seedRepo.id) {
            sameRepo.push(symbol);
            continue;
        }
        const consumerRepoId = symbol.relationship === "exports-to" ? repo.id : seedRepo.id;
        const producerRepoId = symbol.relationship === "exports-to" ? seedRepo.id : repo.id;
        const kinds = resolveBoundaryKinds(args.boundaryEvidence, absolute, consumerRepoId, producerRepoId);
        const allowedKind = pickAllowedKind(kinds, allowlist);
        const allowedByBoundary = Boolean(allowedKind);
        const scopeAllows = !repoScope || (isRepoIdInScope(seedRepo.id, repoScope) && isRepoIdInScope(repo.id, repoScope));
        const allowCrossRepoEdits = args.policy.allowCrossRepoEdits;
        const policyAllows = allowCrossRepoEdits === undefined
            ? true
            : allowCrossRepoEdits;
        const allowedByPolicy = Boolean(policyAllows && seedRepo.allowCrossRepoEdits && repo.allowCrossRepoEdits && scopeAllows);
        const kindForCount = allowedKind ?? (kinds.size > 0 ? Array.from(kinds)[0] : undefined);
        if (kindForCount) {
            kindCounts.set(kindForCount, (kindCounts.get(kindForCount) ?? 0) + 1);
        }

        if (allowedByPolicy && allowedByBoundary) {
            crossRepo.push(symbol);
        } else {
            blocked.push(symbol);
        }
    }

    const caps = resolveCrossBoundaryCaps(args.config, args.projectFileCount);
    let truncated = false;
    let allowedCrossRepo = crossRepo;
    if (Number.isFinite(caps.maxFiles) && caps.maxFiles > 0 && crossRepo.length > caps.maxFiles) {
        allowedCrossRepo = crossRepo.slice(0, caps.maxFiles);
        truncated = true;
    }

    const filtered = [...sameRepo, ...allowedCrossRepo];
    if (filtered.length !== originalData.length) {
        container.data = filtered;
    }
    if (truncated) {
        container.state = ExpansionState.TRUNCATED;
        container.totalCount = originalData.length;
    }
    if (blocked.length > 0) {
        args.degradedReasons.push("graphrag_cross_boundary_blocked");
    }

    const hasCrossRepo = crossRepo.length > 0 || blocked.length > 0;
    if (!hasCrossRepo) {
        return undefined;
    }
    return {
        kind: pickDominantKind(kindCounts),
        autoExpanded: allowedCrossRepo.length > 0,
        truncated
    };
};

const buildBoundaryEvidence = async (
    rootPath: string,
    boundaryRegistry: BoundaryAdapterRegistry,
    repoRegistry: RepoRegistry,
    pathNormalizer: PathNormalizer
): Promise<BoundaryEvidenceCache | null> => {
    const adapters = boundaryRegistry.getAll();
    if (adapters.length === 0) {
        return null;
    }

    const cache: BoundaryEvidenceCache = {
        builtAt: Date.now(),
        byPath: new Map(),
        byRepoPair: new Map()
    };

    for (const adapter of adapters) {
        let instances: BoundaryInstance[] = [];
        try {
            instances = await adapter.discover(rootPath, repoRegistry);
        } catch {
            continue;
        }
        for (const instance of instances) {
            indexBoundaryInstance(instance, cache, pathNormalizer);
        }
    }

    return cache;
};

const indexBoundaryInstance = (
    instance: BoundaryInstance,
    cache: BoundaryEvidenceCache,
    pathNormalizer: PathNormalizer
): void => {
    for (const evidence of instance.evidence ?? []) {
        const key = toPathKey(evidence.path, pathNormalizer);
        if (!key) continue;
        addBoundaryKind(cache.byPath, key, instance.kind);
    }
    for (const consumerRepoId of instance.consumerRepoIds ?? []) {
        const key = buildRepoPairKey(consumerRepoId, instance.producerRepoId);
        addBoundaryKind(cache.byRepoPair, key, instance.kind);
    }
};

const addBoundaryKind = (
    map: Map<string, Set<BoundaryKind>>,
    key: string,
    kind: BoundaryKind
): void => {
    const existing = map.get(key);
    if (existing) {
        existing.add(kind);
        return;
    }
    map.set(key, new Set([kind]));
};

const toPathKey = (filePath: string, pathNormalizer: PathNormalizer): string => {
    const absolute = pathNormalizer.toAbsolute(filePath);
    return absolute.replace(/\\/g, "/");
};

const buildRepoPairKey = (consumerRepoId: string, producerRepoId: string): string => {
    return `${consumerRepoId}::${producerRepoId}`;
};

const resolveBoundaryKinds = (
    boundaryEvidence: BoundaryEvidenceCache | null,
    filePathKey: string,
    consumerRepoId: string,
    producerRepoId: string
): Set<BoundaryKind> => {
    const kinds = new Set<BoundaryKind>();
    if (!boundaryEvidence) {
        return kinds;
    }

    const byPath = boundaryEvidence.byPath.get(filePathKey);
    if (byPath) {
        for (const kind of byPath) {
            kinds.add(kind);
        }
    }

    const byRepoPair = boundaryEvidence.byRepoPair.get(buildRepoPairKey(consumerRepoId, producerRepoId));
    if (byRepoPair) {
        for (const kind of byRepoPair) {
            kinds.add(kind);
        }
    }

    return kinds;
};

const pickAllowedKind = (kinds: Set<BoundaryKind>, allowlist: Set<string>): BoundaryKind | undefined => {
    for (const kind of kinds) {
        if (allowlist.has(kind)) {
            return kind;
        }
    }
    return undefined;
};

const pickDominantKind = (kindCounts: Map<string, number>): string | undefined => {
    let selected: string | undefined;
    let best = 0;
    for (const [kind, count] of kindCounts) {
        if (count > best) {
            best = count;
            selected = kind;
        }
    }
    return selected;
};
