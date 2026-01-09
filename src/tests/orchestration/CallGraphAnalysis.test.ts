import { describe, it, expect } from "@jest/globals";
import { OrchestrationContext } from "../../orchestration/OrchestrationContext.js";
import { extractSymbol, fetchCallGraph } from "../../orchestration/pillars/understand/CallGraphAnalysis.js";

describe("CallGraphAnalysis", () => {
  it("extracts symbols from intents", () => {
    expect(extractSymbol("method foo"))
      .toBe("foo");
    expect(extractSymbol("Service#bar"))
      .toBe("bar");
    expect(extractSymbol("Service.doWork"))
      .toBe("doWork");
    expect(extractSymbol("file.ts")).toBeNull();
  });

  it("fetches call graph via relationship_analyze", async () => {
    const context = new OrchestrationContext();
    const runTool = async (_ctx: OrchestrationContext, tool: string, args: any) => ({
      tool,
      args
    });

    const result = await fetchCallGraph({
      context,
      filePath: "src/main.ts",
      symbolName: "foo",
      depth: "deep",
      runTool
    });

    expect(result.tool).toBe("relationship_analyze");
    expect(result.args.maxDepth).toBe(3);
  });
});
