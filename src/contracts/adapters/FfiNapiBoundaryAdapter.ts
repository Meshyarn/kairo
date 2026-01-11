import fs from "fs";
import path from "path";
import type { RepoRegistry } from "../../config/RepoRegistry.js";
import type { BoundaryAdapter, BoundaryInstance, ContractLoadResult, ContractManifest } from "../boundaries/types.js";
import { normalizeManifestId } from "./AdapterUtils.js";

export class FfiNapiBoundaryAdapter implements BoundaryAdapter {
  readonly kind = "ffi_napi" as const;

  constructor(private readonly rootPath: string) {}

  async discover(root: string, repoRegistry: RepoRegistry): Promise<BoundaryInstance[]> {
    const instances: BoundaryInstance[] = [];
    const repo = repoRegistry.getDefaultRepo();
    const repoId = repo?.id ?? "default";
    const manifestDir = path.join(root, ".kairo", "contracts", this.kind);
    if (!fs.existsSync(manifestDir)) {
      return instances;
    }
    const entries = fs.readdirSync(manifestDir, { withFileTypes: true }).filter((entry) => entry.isFile());
    for (const entry of entries) {
      if (!entry.name.endsWith(".json")) continue;
      const manifestPath = path.join(manifestDir, entry.name);
      const evidencePath = path.relative(root, manifestPath).replace(/\\/g, "/");
      const id = normalizeManifestId(entry.name.replace(/\.json$/i, ""));
      instances.push({
        id,
        kind: this.kind,
        producerRepoId: repoId,
        consumerRepoIds: [],
        evidence: [{ path: evidencePath, type: "contract_manifest" }],
        confidence: "high"
      });
    }
    return instances;
  }

  async loadOrGenerate(instance: BoundaryInstance): Promise<ContractLoadResult> {
    const manifestPath = path.join(this.rootPath, ".kairo", "contracts", this.kind, `${instance.id}.json`);
    if (!fs.existsSync(manifestPath)) {
      return { degraded: true, reasons: ["contract_manifest_missing"] };
    }
    try {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(raw) as ContractManifest;
      return { manifest, reasons: [] };
    } catch {
      return { degraded: true, reasons: ["contract_manifest_invalid"] };
    }
  }
}
