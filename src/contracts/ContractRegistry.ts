import type { RepoRegistry } from "../config/RepoRegistry.js";
import type { BoundaryAdapter, BoundaryInstance, BoundaryKind, ContractLoadResult, ContractManifest } from "./boundaries/types.js";

type BoundaryCacheEntry = {
  instance: BoundaryInstance;
  manifest?: ContractManifest;
  degraded?: boolean;
  reasons: string[];
  loadedAt: number;
};

export class ContractRegistry {
  private adapters: BoundaryAdapter[] = [];
  private cache = new Map<string, BoundaryCacheEntry>();

  constructor(
    private readonly rootPath: string,
    private readonly repoRegistry: RepoRegistry
  ) {}

  public registerAdapter(adapter: BoundaryAdapter) {
    this.adapters.push(adapter);
  }

  public listAdapters(): BoundaryKind[] {
    return this.adapters.map((adapter) => adapter.kind);
  }

  public async discoverBoundaries(): Promise<BoundaryInstance[]> {
    const boundaries: BoundaryInstance[] = [];
    for (const adapter of this.adapters) {
      const discovered = await adapter.discover(this.rootPath, this.repoRegistry);
      boundaries.push(...discovered);
    }
    return boundaries;
  }

  public async loadManifest(instance: BoundaryInstance): Promise<ContractLoadResult> {
    const cached = this.cache.get(instance.id);
    if (cached) {
      return {
        manifest: cached.manifest,
        degraded: cached.degraded,
        reasons: cached.reasons
      };
    }

    const adapter = this.adapters.find((entry) => entry.kind === instance.kind);
    if (!adapter) {
      return { reasons: ["contract_adapter_missing"], degraded: true };
    }

    const result = await adapter.loadOrGenerate(instance);
    this.cache.set(instance.id, {
      instance,
      manifest: result.manifest,
      degraded: result.degraded,
      reasons: result.reasons,
      loadedAt: Date.now()
    });
    return result;
  }
}
