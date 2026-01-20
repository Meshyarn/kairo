import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PathManager } from "../../utils/PathManager.js";
import { resolveEnvelopeMaxTokens, resolveMcpPolicy } from "../../orchestration/policy/McpModePresetRegistry.js";

const writeMcpConfig = (root: string, payload: Record<string, unknown>) => {
  const configDir = path.join(root, ".kairo", "config");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "mcp.json"), JSON.stringify(payload, null, 2));
};

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "kairo-mcp-"));

describe("McpModePresetRegistry", () => {
  const originalEnv = { ...process.env };
  const originalRoot = process.cwd();

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    PathManager.setRoot(originalRoot);
  });

  it("defaults to dev mode when unset", () => {
    const root = makeTempRoot();
    PathManager.setRoot(root);
    const policy = resolveMcpPolicy();
    expect(policy.mode).toBe("dev");
    expect(policy.preset).toBeUndefined();
  });

  it("prefers config preset over env", () => {
    const root = makeTempRoot();
    PathManager.setRoot(root);
    process.env.KAIRO_MODE = "mcp";
    process.env.KAIRO_PRESET = "mcp-deep";
    writeMcpConfig(root, { preset: "mcp-balanced" });
    const policy = resolveMcpPolicy();
    expect(policy.mode).toBe("mcp");
    expect(policy.preset).toBe("mcp-balanced");
  });

  it("defaults to mcp-lean when mode is mcp", () => {
    const root = makeTempRoot();
    PathManager.setRoot(root);
    process.env.KAIRO_MODE = "mcp";
    const policy = resolveMcpPolicy();
    expect(policy.preset).toBe("mcp-lean");
    expect(policy.publicSurface).toBe("compact");
  });

  it("uses config budget ahead of env", () => {
    const root = makeTempRoot();
    PathManager.setRoot(root);
    process.env.KAIRO_MODE = "mcp";
    process.env.KAIRO_EXPLORE_MAX_TOKENS = "5000";
    writeMcpConfig(root, {
      preset: "mcp-lean",
      budgets: { envelopeMaxTokens: { explore: 4200 } }
    });
    const maxTokens = resolveEnvelopeMaxTokens("explore");
    expect(maxTokens).toBe(4200);
  });

  it("honors KAIRO_PUBLIC_SURFACE override", () => {
    const root = makeTempRoot();
    PathManager.setRoot(root);
    process.env.KAIRO_MODE = "mcp";
    process.env.KAIRO_PUBLIC_SURFACE = "pillars";
    const policy = resolveMcpPolicy();
    expect(policy.publicSurface).toBe("pillars");
  });
});
