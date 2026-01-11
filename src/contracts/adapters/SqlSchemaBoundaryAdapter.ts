import fs from "fs";
import path from "path";
import type { RepoRegistry } from "../../config/RepoRegistry.js";
import type { BoundaryAdapter, BoundaryInstance, ContractLoadResult, ContractManifest } from "../boundaries/types.js";
import {
  buildIgnoreFilter,
  buildEvidence,
  filterByExtensions,
  normalizeManifestId,
  scanForPattern,
  walkRepoFiles,
  loadFileContent
} from "./AdapterUtils.js";

type SqlTable = {
  name: string;
  columns: Array<{ name: string; type: string }>;
};

export class SqlSchemaBoundaryAdapter implements BoundaryAdapter {
  readonly kind = "db_sql_schema" as const;

  constructor(private readonly rootPath: string) {}

  async discover(root: string, repoRegistry: RepoRegistry): Promise<BoundaryInstance[]> {
    const instances: BoundaryInstance[] = [];
    const repos = repoRegistry.getAllRepos();

    for (const repo of repos) {
      const filter = buildIgnoreFilter(repo);
      const files = walkRepoFiles(repo, filter);
      const sqlFiles = filterByExtensions(files, [".sql"]);
      const schemaFiles = sqlFiles.filter((file) => this.isSchemaCandidate(file.relativePath));
      if (schemaFiles.length === 0) continue;

      const evidence = buildEvidence(
        schemaFiles.map((file) => path.relative(root, file.absolutePath).replace(/\\/g, "/")),
        "sql_schema"
      );
      const id = normalizeManifestId(`${this.kind}:${repo.id}`);
      const consumerRepoIds = this.detectConsumers(repos, repo.id, schemaFiles);

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
    const manifestPath = path.join(this.rootPath, ".kairo", "contracts", this.kind, `${instance.id}.json`);
    if (fs.existsSync(manifestPath)) {
      try {
        const raw = fs.readFileSync(manifestPath, "utf-8");
        const manifest = JSON.parse(raw) as ContractManifest;
        return { manifest, reasons: [] };
      } catch {
        return { degraded: true, reasons: ["contract_manifest_invalid"] };
      }
    }

    const schemaFiles = instance.evidence
      .filter((item) => item.type === "sql_schema")
      .map((item) => path.resolve(this.rootPath, item.path));
    if (schemaFiles.length === 0) {
      return { degraded: true, reasons: ["contract_manifest_missing"] };
    }

    const tables = this.parseSchema(schemaFiles);
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
        dialect: this.inferDialect(schemaFiles[0]),
        tables
      }
    };

    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    return { manifest, reasons: [] };
  }

  private detectConsumers(
    repos: ReturnType<RepoRegistry["getAllRepos"]>,
    producerId: string,
    schemaFiles: Array<{ absolutePath: string; relativePath: string }>
  ): string[] {
    const tables = this.extractTableNames(schemaFiles.map((file) => file.absolutePath));
    if (tables.length === 0) {
      return [];
    }
    const matcher = new RegExp(`\\b(from|join|into|update)\\s+(${tables.join("|")})\\b`, "i");
    const consumers: string[] = [];

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

  private parseSchema(files: string[]): Record<string, unknown> {
    const tables: Record<string, SqlTable> = {};
    for (const filePath of files) {
      let content = "";
      try {
        content = loadFileContent(filePath);
      } catch {
        continue;
      }
      for (const match of content.matchAll(/create\s+table\s+([A-Za-z0-9_\\.]+)\s*\(([\s\S]*?)\);/gi)) {
        const name = match[1];
        const body = match[2] ?? "";
        const columns: SqlTable["columns"] = [];
        for (const line of body.split(/\r?\n/)) {
          const trimmed = line.trim().replace(/,$/, "");
          if (!trimmed || trimmed.toLowerCase().startsWith("constraint")) continue;
          const parts = trimmed.split(/\s+/);
          if (parts.length < 2) continue;
          const columnName = parts[0].replace(/["'`]/g, "");
          const type = parts[1];
          columns.push({ name: columnName, type });
        }
        tables[name] = { name, columns };
      }
    }
    const output: Record<string, unknown> = {};
    for (const [name, table] of Object.entries(tables)) {
      output[name] = { columns: table.columns };
    }
    return output;
  }

  private extractTableNames(files: string[]): string[] {
    const names = new Set<string>();
    for (const filePath of files) {
      let content = "";
      try {
        content = loadFileContent(filePath);
      } catch {
        continue;
      }
      for (const match of content.matchAll(/create\s+table\s+([A-Za-z0-9_\\.]+)/gi)) {
        names.add(match[1]);
      }
    }
    return Array.from(names.values());
  }

  private inferDialect(filePath: string): string | undefined {
    const lower = path.basename(filePath).toLowerCase();
    if (lower.includes("postgres")) return "postgresql";
    if (lower.includes("mysql")) return "mysql";
    if (lower.includes("sqlite")) return "sqlite";
    return undefined;
  }

  private isSchemaCandidate(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
    const base = path.basename(normalized);
    if (base === "schema.sql") return true;
    if (normalized.includes("/migrations/") || normalized.includes("/migration/")) return true;
    if (normalized.includes("/db/")) return true;
    return false;
  }
}
