import fs from "fs";
import path from "path";
import type { RepoRegistry } from "../../config/RepoRegistry.js";
import type { BoundaryAdapter, BoundaryInstance, ContractLoadResult, ContractManifest } from "../boundaries/types.js";
import { PathManager } from "../../utils/PathManager.js";
import {
  buildIgnoreFilter,
  buildEvidence,
  filterByBasename,
  normalizeManifestId,
  scanForPattern,
  walkRepoFiles,
  loadFileContent
} from "./AdapterUtils.js";

type OpenApiSpec = {
  title?: string;
  version?: string;
  operations: Record<string, unknown>;
};

export class OpenApiBoundaryAdapter implements BoundaryAdapter {
  readonly kind = "http_openapi" as const;

  constructor(private readonly rootPath: string) {}

  async discover(root: string, repoRegistry: RepoRegistry): Promise<BoundaryInstance[]> {
    const instances: BoundaryInstance[] = [];
    const repos = repoRegistry.getAllRepos();

    const targets = ["openapi.yaml", "openapi.yml", "openapi.json", "swagger.json"];

    for (const repo of repos) {
      const filter = buildIgnoreFilter(repo);
      const files = walkRepoFiles(repo, filter);
      const specFiles = filterByBasename(files, targets);
      if (specFiles.length === 0) continue;

      const evidence = buildEvidence(
        specFiles.map((file) => path.relative(root, file.absolutePath).replace(/\\/g, "/")),
        "openapi_spec"
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
    const manifestPath = PathManager.resolveForRoot(this.rootPath, "contracts", this.kind, `${instance.id}.json`);
    if (fs.existsSync(manifestPath)) {
      try {
        const raw = fs.readFileSync(manifestPath, "utf-8");
        const manifest = JSON.parse(raw) as ContractManifest;
        return { manifest, reasons: [] };
      } catch {
        return { degraded: true, reasons: ["contract_manifest_invalid"] };
      }
    }

    const specFiles = instance.evidence
      .filter((item) => item.type === "openapi_spec")
      .map((item) => path.resolve(this.rootPath, item.path));

    if (specFiles.length === 0) {
      return { degraded: true, reasons: ["contract_manifest_missing"] };
    }

    const spec = this.parseSpec(specFiles[0]);
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
        title: spec.title,
        version: spec.version,
        operations: spec.operations
      }
    };

    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    return { manifest, reasons: [] };
  }

  private detectConsumers(repos: ReturnType<RepoRegistry["getAllRepos"]>, producerId: string): string[] {
    const consumers: string[] = [];
    const matcher = /\b(fetch|axios|superagent|got)\b/i;
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

  private parseSpec(filePath: string): OpenApiSpec {
    const lower = filePath.toLowerCase();
    if (lower.endsWith(".json")) {
      return this.parseJsonSpec(filePath);
    }
    return this.parseYamlSpec(filePath);
  }

  private parseJsonSpec(filePath: string): OpenApiSpec {
    try {
      const raw = loadFileContent(filePath);
      const parsed = JSON.parse(raw);
      const title = parsed?.info?.title;
      const version = parsed?.info?.version;
      const operations: Record<string, unknown> = {};
      const paths = parsed?.paths ?? {};
      for (const [pathKey, methods] of Object.entries(paths)) {
        for (const [method, spec] of Object.entries(methods as Record<string, unknown>)) {
          operations[`${method.toUpperCase()} ${pathKey}`] = spec;
        }
      }
      return { title, version, operations };
    } catch {
      return { operations: {} };
    }
  }

  private parseYamlSpec(filePath: string): OpenApiSpec {
    const raw = loadFileContent(filePath);
    const lines = raw.split(/\r?\n/);
    let title: string | undefined;
    let version: string | undefined;
    let inPaths = false;
    let pathsIndent = 0;
    let currentPath: string | null = null;
    const operations: Record<string, unknown> = {};

    for (const line of lines) {
      if (!title) {
        const titleMatch = line.match(/^\s*title:\s*(.+)$/);
        if (titleMatch) {
          title = titleMatch[1].trim().replace(/^['"]|['"]$/g, "");
        }
      }
      if (!version) {
        const versionMatch = line.match(/^\s*version:\s*(.+)$/);
        if (versionMatch) {
          version = versionMatch[1].trim().replace(/^['"]|['"]$/g, "");
        }
      }
      if (!inPaths) {
        const pathsMatch = line.match(/^(\s*)paths:\s*$/);
        if (pathsMatch) {
          inPaths = true;
          pathsIndent = pathsMatch[1]?.length ?? 0;
        }
        continue;
      }

      const indentMatch = line.match(/^(\s*)(\S.*)$/);
      if (!indentMatch) continue;
      const indent = indentMatch[1].length;
      const content = indentMatch[2];
      if (indent <= pathsIndent) {
        inPaths = false;
        currentPath = null;
        continue;
      }
      const pathMatch = content.match(/^(\/[^:]+):\s*$/);
      if (pathMatch) {
        currentPath = pathMatch[1];
        continue;
      }
      const methodMatch = content.match(/^(get|post|put|patch|delete|options|head):\s*$/i);
      if (methodMatch && currentPath) {
        const method = methodMatch[1].toUpperCase();
        operations[`${method} ${currentPath}`] = {};
      }
    }

    return { title, version, operations };
  }
}
