import fs from "fs";
import os from "os";
import path from "path";
import { jest } from "@jest/globals";
import { createDefaultToolSpecRegistry } from "../../server/tools/ToolSpecRegistry.js";

export const makeContext = (overrides: Record<string, unknown> = {}) => {
  const executePillar = jest.fn<(...args: any[]) => Promise<any>>();
  return {
    rootPath: process.cwd(),
    orchestrationEngine: { executePillar },
    toolSpecRegistry: createDefaultToolSpecRegistry(),
    indexStateManager: { getDirtyFiles: jest.fn(() => []) },
    isTestEnv: () => true,
    ...overrides
  };
};

export const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "kairo-task-"));

export const writeMcpConfig = (root: string, payload: Record<string, unknown>) => {
  const configDir = path.join(root, ".kairo", "config");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "mcp.json"), JSON.stringify(payload, null, 2));
};
