import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { RepoRegistry } from "../../../config/RepoRegistry.js";
import { PathManager } from "../../../utils/PathManager.js";
import { SqlSchemaBoundaryAdapter } from "../../../contracts/adapters/SqlSchemaBoundaryAdapter.js";

describe("SqlSchemaBoundaryAdapter", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-sql-"));
    fs.mkdirSync(path.join(root, "db"), { recursive: true });
    fs.mkdirSync(path.join(root, "consumer", "src"), { recursive: true });
    fs.mkdirSync(path.join(root, ".kairo", "config"), { recursive: true });

    fs.writeFileSync(
      path.join(root, "db", "schema.sql"),
      [
        "create table users (",
        "  id integer,",
        "  name text",
        ");"
      ].join("\n"),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(root, "consumer", "src", "query.sql"),
      "select * from users;",
      "utf-8"
    );

    fs.writeFileSync(
      path.join(root, ".kairo", "config", "mcp-config.json"),
      JSON.stringify({
        version: "1.0",
        defaultRepo: "main",
        repositories: {
          main: { path: ".", name: "Main", type: "primary", languages: [] },
          consumer: { path: "consumer", name: "Consumer", type: "linked", languages: [] }
        }
      }),
      "utf-8"
    );
  });

  afterEach(() => {
    PathManager.setRoot(process.cwd());
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("discovers SQL schemas and generates manifest", async () => {
    PathManager.setRoot(root);
    const repoRegistry = new RepoRegistry(root);
    const adapter = new SqlSchemaBoundaryAdapter(root);

    const instances = await adapter.discover(root, repoRegistry);
    expect(instances.length).toBe(1);
    expect(instances[0].consumerRepoIds).toContain("consumer");

    const result = await adapter.loadOrGenerate(instances[0]);
    expect(result.manifest?.surface.kind).toBe("db_sql_schema");
    expect(result.manifest?.surface).toHaveProperty("tables");
    const manifestPath = path.join(root, ".kairo", "contracts", "db_sql_schema", `${instances[0].id}.json`);
    expect(fs.existsSync(manifestPath)).toBe(true);
  });
});
