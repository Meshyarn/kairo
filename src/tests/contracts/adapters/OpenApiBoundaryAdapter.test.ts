import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { RepoRegistry } from "../../../config/RepoRegistry.js";
import { PathManager } from "../../../utils/PathManager.js";
import { OpenApiBoundaryAdapter } from "../../../contracts/adapters/OpenApiBoundaryAdapter.js";

describe("OpenApiBoundaryAdapter", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-openapi-"));
    fs.mkdirSync(path.join(root, "api"), { recursive: true });
    fs.mkdirSync(path.join(root, "consumer", "src"), { recursive: true });
    fs.mkdirSync(path.join(root, ".kairo", "config"), { recursive: true });

    fs.writeFileSync(
      path.join(root, "api", "openapi.json"),
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Example API", version: "1.0.0" },
        paths: { "/users": { get: { summary: "list users" } } }
      }),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(root, "consumer", "src", "client.ts"),
      "export const listUsers = () => axios.get('/users');",
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

  it("discovers OpenAPI specs and generates manifest", async () => {
    PathManager.setRoot(root);
    const repoRegistry = new RepoRegistry(root);
    const adapter = new OpenApiBoundaryAdapter(root);

    const instances = await adapter.discover(root, repoRegistry);
    expect(instances.length).toBe(1);
    expect(instances[0].consumerRepoIds).toContain("consumer");

    const result = await adapter.loadOrGenerate(instances[0]);
    expect(result.manifest?.surface.kind).toBe("http_openapi");
    expect(result.manifest?.surface).toHaveProperty("operations");
    const manifestPath = path.join(root, ".kairo", "contracts", "http_openapi", `${instances[0].id}.json`);
    expect(fs.existsSync(manifestPath)).toBe(true);
  });
});
