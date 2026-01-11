import type { BoundaryAdapter, BoundaryKind } from "./boundaries/types.js";
import type { RepoRegistry } from "../config/RepoRegistry.js";
import { FfiNapiBoundaryAdapter } from "./adapters/FfiNapiBoundaryAdapter.js";
import { ProtoBoundaryAdapter } from "./adapters/ProtoBoundaryAdapter.js";
import { OpenApiBoundaryAdapter } from "./adapters/OpenApiBoundaryAdapter.js";
import { SqlSchemaBoundaryAdapter } from "./adapters/SqlSchemaBoundaryAdapter.js";

export class BoundaryAdapterRegistry {
  private adapters: BoundaryAdapter[] = [];

  constructor(private readonly rootPath: string, private readonly repoRegistry: RepoRegistry) {}

  register(adapter: BoundaryAdapter): void {
    this.adapters.push(adapter);
  }

  list(): BoundaryKind[] {
    return this.adapters.map((adapter) => adapter.kind);
  }

  getAdapter(kind: BoundaryKind): BoundaryAdapter | undefined {
    return this.adapters.find((adapter) => adapter.kind === kind);
  }

  getAll(): BoundaryAdapter[] {
    return [...this.adapters];
  }

  static createDefault(rootPath: string, repoRegistry: RepoRegistry): BoundaryAdapterRegistry {
    const registry = new BoundaryAdapterRegistry(rootPath, repoRegistry);
    registry.register(new FfiNapiBoundaryAdapter(rootPath));
    registry.register(new ProtoBoundaryAdapter(rootPath));
    registry.register(new OpenApiBoundaryAdapter(rootPath));
    registry.register(new SqlSchemaBoundaryAdapter(rootPath));
    return registry;
  }
}
