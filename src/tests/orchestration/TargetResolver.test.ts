import { describe, it, expect, jest } from "@jest/globals";
import { resolveTargetPath } from "../../orchestration/pillars/change/shared/TargetResolver.js";

describe("TargetResolver", () => {
  it("returns explicit path without invoking search", async () => {
    const runTool = jest.fn(async (_ctx: any, _tool: string, _args: any) => ({}));
    const result = await resolveTargetPath("update src/app.ts", {} as any, runTool as any);

    expect(result.targetPath).toBe("src/app.ts");
    expect(runTool).not.toHaveBeenCalled();
  });

  it("prioritizes higher scored candidates from search", async () => {
    const runTool = jest.fn(async (_ctx: any, tool: string, args: any) => {
      if (tool === "project_search" && args.type === "filename") {
        return { results: [{ path: "src/alpha.ts", score: 0.2 }] };
      }
      if (tool === "project_search" && args.type === "symbol") {
        return { results: [{ path: "src/beta.ts", score: 0.8 }] };
      }
      return {};
    });

    const result = await resolveTargetPath("Rename Beta", {} as any, runTool as any);
    expect(result.targetPath).toBe("src/beta.ts");
    expect(result.candidates[0].reason).toBe("symbol_search");
  });
});
