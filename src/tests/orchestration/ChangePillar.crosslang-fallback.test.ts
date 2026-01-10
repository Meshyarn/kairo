import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { OrchestrationContext } from "../../orchestration/OrchestrationContext.js";
import { ChangePillar } from "../../orchestration/pillars/change/ChangePillar.js";

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "kairo-crosslang-"));

describe("ChangePillar cross-language fallback consumers", () => {
  it("filters fallback consumers to actual importers", async () => {
    const root = makeTempDir();
    const consumerPath = path.join(root, "consumer.ts");
    const otherPath = path.join(root, "other.ts");
    fs.writeFileSync(
      consumerPath,
      'import { ChunkResult } from "@kairo/core-rs";\nconsole.log(ChunkResult);\n',
      "utf-8"
    );
    fs.writeFileSync(otherPath, "export const value = 1;\n", "utf-8");

    const registry = {
      execute: async (tool: string) => {
        if (tool === "project_search") {
          return { results: [{ path: consumerPath }, { path: otherPath }] };
        }
        return {};
      }
    };

    const pillar = new ChangePillar(registry as any);
    const context = new OrchestrationContext();

    const results = await (pillar as any).findFallbackConsumers(
      context,
      "@kairo/core-rs",
      path.join(root, "index.d.ts")
    );

    expect(results).toEqual([consumerPath]);

    fs.rmSync(root, { recursive: true, force: true });
  });
});
