import { describe, it, expect, jest } from "@jest/globals";
import { InternalToolRegistry } from "../../orchestration/InternalToolRegistry.js";
import { OrchestrationContext } from "../../orchestration/OrchestrationContext.js";
import { WritePillar } from "../../orchestration/pillars/WritePillar.js";

const makeIntent = (constraints: Record<string, any>) => ({
  category: "write",
  action: "execute",
  targets: [],
  originalIntent: "create function greet returns string",
  constraints,
  confidence: 1
});

jest.setTimeout(30000);

describe("WritePillar", () => {
  it("fails when targetPath is missing", async () => {
    const registry = new InternalToolRegistry();
    const pillar = new WritePillar(registry);
    const context = new OrchestrationContext();

    const result = await pillar.execute(makeIntent({}) as any, context);

    expect(result.success).toBe(false);
    expect(result.status).toBe("failure");
  });

  it("quickGenerate writes generated code", async () => {
    const registry = new InternalToolRegistry();
    registry.register("code_read", async () => {
      throw new Error("missing");
    });
    registry.register("file_write", async () => ({ success: true }));
    registry.register("edit_transaction", async () => ({ success: true, operation: { id: "op-1" } }));

    const pillar = new WritePillar(registry);
    const context = new OrchestrationContext();
    const result = await pillar.execute(
      makeIntent({ targetPath: "src/greet.ts", quickGenerate: true }) as any,
      context
    );

    expect(result.success).toBe(true);
    expect(result.writeMode).toBe("quickGenerate");
    expect(result.createdFiles[0].path).toBe("src/greet.ts");
  });

  it("safeWrite uses edit_transaction with hashes", async () => {
    const registry = new InternalToolRegistry();
    registry.register("code_read", async () => "old");
    registry.register("edit_transaction", async () => ({ success: true, operation: { id: "op-2" } }));

    const pillar = new WritePillar(registry);
    const context = new OrchestrationContext();
    const result = await pillar.execute(
      makeIntent({ targetPath: "src/output.ts", content: "new", safeWrite: true }) as any,
      context
    );

    expect(result.success).toBe(true);
    expect(result.writeMode).toBe("safe");
    expect(result.rollbackAvailable).toBe(true);
  });

  it("parses generation intent helpers", () => {
    const registry = new InternalToolRegistry();
    const pillar = new WritePillar(registry);

    const parsed = (pillar as any).parseGenerationIntent(
      "create class Widget",
      "src/widget.ts"
    );
    expect(parsed.templateType).toBe("class");
    expect(parsed.context.name).toBe("Widget");

    expect((pillar as any).extractParams("function takes a, b and c")).toBe("a, b, c");
    expect((pillar as any).extractReturnType("returns Promise<string>")).toBe("Promise<string>");
    expect((pillar as any).extractDescription("create a helper"))
      .toBe("Helper");
  });
});
