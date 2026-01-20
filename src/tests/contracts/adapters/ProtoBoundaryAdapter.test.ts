import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { RepoRegistry } from "../../../config/RepoRegistry.js";
import { PathManager } from "../../../utils/PathManager.js";
import { ProtoBoundaryAdapter } from "../../../contracts/adapters/ProtoBoundaryAdapter.js";

describe("ProtoBoundaryAdapter", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-proto-"));
    fs.mkdirSync(path.join(root, "api"), { recursive: true });
    fs.mkdirSync(path.join(root, "consumer", "src"), { recursive: true });
    fs.mkdirSync(path.join(root, ".kairo", "config"), { recursive: true });

    fs.writeFileSync(
      path.join(root, "api", "service.proto"),
      [
        "syntax = \"proto3\";",
        "package example.service;",
        "message ExampleRequest {",
        "  string name = 1;",
        "}",
        "service ExampleService {",
        "  rpc GetUser (ExampleRequest) returns (ExampleRequest);",
        "}"
      ].join("\n"),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(root, "consumer", "src", "client.ts"),
      "import { ExampleService } from '../api/service.pb';",
      "utf-8"
    );

    fs.writeFileSync(
      path.join(root, ".kairo", "config", ".mcp-config.json"),
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

  it("discovers proto boundaries and generates manifest", async () => {
    PathManager.setRoot(root);
    const repoRegistry = new RepoRegistry(root);
    const adapter = new ProtoBoundaryAdapter(root);

    const instances = await adapter.discover(root, repoRegistry);
    expect(instances.length).toBe(1);
    expect(instances[0].consumerRepoIds).toContain("consumer");

    const result = await adapter.loadOrGenerate(instances[0]);
    expect(result.manifest?.surface.kind).toBe("idl_proto");
    expect(result.manifest?.surface).toHaveProperty("packages");
    const manifestPath = path.join(root, ".kairo", "contracts", "idl_proto", `${instances[0].id}.json`);
    expect(fs.existsSync(manifestPath)).toBe(true);
  });
});
