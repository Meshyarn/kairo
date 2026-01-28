import fs from "fs";
import path from "path";
import type { RepoRegistry } from "../../config/RepoRegistry.js";
import type { BoundaryAdapter, BoundaryInstance, ContractLoadResult, ContractManifest } from "../boundaries/types.js";
import { PathManager } from "../../utils/PathManager.js";
import {
  buildIgnoreFilter,
  buildEvidence,
  filterByExtensions,
  normalizeManifestId,
  scanForPattern,
  walkRepoFiles,
  loadFileContent
} from "./AdapterUtils.js";

type ProtoService = {
  name: string;
  methods: Array<{ name: string; request: string; response: string }>;
};

type ProtoMessage = {
  name: string;
  fields: Array<{ name: string; type: string }>;
};

export class ProtoBoundaryAdapter implements BoundaryAdapter {
  readonly kind = "idl_proto" as const;

  constructor(private readonly rootPath: string) {}

  async discover(root: string, repoRegistry: RepoRegistry): Promise<BoundaryInstance[]> {
    const instances: BoundaryInstance[] = [];
    const repos = repoRegistry.getAllRepos();

    for (const repo of repos) {
      const filter = buildIgnoreFilter(repo);
      const files = walkRepoFiles(repo, filter);
      const protoFiles = filterByExtensions(files, [".proto"]);
      if (protoFiles.length === 0) continue;

      const evidence = buildEvidence(
        protoFiles.map((file) => path.relative(root, file.absolutePath).replace(/\\/g, "/")),
        "proto_file"
      );
      const id = normalizeManifestId(`${this.kind}:${repo.id}`);
      const consumerRepoIds = this.detectConsumers(repos, repo.id);

      instances.push({
        id,
        kind: this.kind,
        producerRepoId: repo.id,
        consumerRepoIds,
        evidence,
        confidence: "medium"
      });
    }

    return instances;
  }

  async loadOrGenerate(instance: BoundaryInstance): Promise<ContractLoadResult> {
    const manifestPath = PathManager.resolveForRoot(
      this.rootPath,
      "contracts",
      this.kind,
      `${instance.id}.json`
    );
    if (fs.existsSync(manifestPath)) {
      try {
        const raw = fs.readFileSync(manifestPath, "utf-8");
        const manifest = JSON.parse(raw) as ContractManifest;
        return { manifest, reasons: [] };
      } catch {
        return { degraded: true, reasons: ["contract_manifest_invalid"] };
      }
    }

    const protoFiles = instance.evidence
      .filter((item) => item.type === "proto_file")
      .map((item) => path.resolve(this.rootPath, item.path));

    if (protoFiles.length === 0) {
      return { degraded: true, reasons: ["contract_manifest_missing"] };
    }

    const parsed = this.parseProtoFiles(protoFiles);
    const manifest: ContractManifest = {
      header: {
        version: "1.0",
        kind: this.kind,
        id: instance.id,
        sourceRepo: instance.producerRepoId,
        generatedAt: Date.now(),
        evidence: instance.evidence
      },
      surface: {
        kind: this.kind,
        packages: parsed.packages,
        services: parsed.services,
        messages: parsed.messages
      }
    };

    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    return { manifest, reasons: [] };
  }

  private detectConsumers(repos: ReturnType<RepoRegistry["getAllRepos"]>, producerId: string): string[] {
    const consumers: string[] = [];
    const matcher = /import\s+[^'"]+['"][^'"]+\.pb['"]|\.pb\b|grpc/i;
    for (const repo of repos) {
      if (repo.id === producerId) continue;
      const filter = buildIgnoreFilter(repo);
      const files = walkRepoFiles(repo, filter);
      if (scanForPattern(files, matcher)) {
        consumers.push(repo.id);
      }
    }
    return consumers;
  }

  private parseProtoFiles(files: string[]): {
    packages: string[];
    services: Record<string, ProtoService>;
    messages: Record<string, ProtoMessage>;
  } {
    const packages = new Set<string>();
    const services: Record<string, ProtoService> = {};
    const messages: Record<string, ProtoMessage> = {};

    for (const filePath of files) {
      let content = "";
      try {
        content = loadFileContent(filePath);
      } catch {
        continue;
      }

      const packageMatch = content.match(/^\s*package\s+([A-Za-z0-9_.]+)\s*;/m);
      if (packageMatch?.[1]) {
        packages.add(packageMatch[1]);
      }

      for (const match of content.matchAll(/service\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\}/g)) {
        const name = match[1];
        const body = match[2] ?? "";
        const methods: ProtoService["methods"] = [];
        for (const rpcMatch of body.matchAll(/rpc\s+([A-Za-z0-9_]+)\s*\(\s*([^)]+)\)\s*returns\s*\(\s*([^)]+)\s*\)/g)) {
          methods.push({
            name: rpcMatch[1],
            request: rpcMatch[2].trim(),
            response: rpcMatch[3].trim()
          });
        }
        services[name] = { name, methods };
      }

      for (const match of content.matchAll(/message\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\}/g)) {
        const name = match[1];
        const body = match[2] ?? "";
        const fields: ProtoMessage["fields"] = [];
        for (const fieldMatch of body.matchAll(/(?:repeated\s+)?([A-Za-z0-9_.]+)\s+([A-Za-z0-9_]+)\s*=\s*\d+/g)) {
          fields.push({ type: fieldMatch[1], name: fieldMatch[2] });
        }
        messages[name] = { name, fields };
      }
    }

    return {
      packages: Array.from(packages.values()).sort(),
      services,
      messages
    };
  }
}
