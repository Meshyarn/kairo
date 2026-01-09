import { describe, it, expect, jest } from "@jest/globals";
import { executeV2BatchChange } from "../../orchestration/pillars/change/BatchExecution.js";

describe("executeV2BatchChange", () => {
  it("maps edits to targetFiles by index when filePath is missing", async () => {
    const resolver = {
      resolveAll: jest.fn(async (_filePath: string, edits: any[]) => ({
        success: true,
        resolvedEdits: edits.map((edit: any) => ({ id: edit.id }))
      }))
    };
    const coordinator = {
      applyBatchResolvedEdits: jest.fn(async () => ({ success: true }))
    };

    const result = await executeV2BatchChange(
      {
        intent: { constraints: {} } as any,
        context: {} as any,
        rawEdits: [{ id: "a" }, { id: "b" }],
        targetFiles: ["src/a.ts", "src/b.ts"],
        dryRun: true,
        v2Mode: "dryrun"
      },
      () => resolver,
      () => coordinator
    );

    expect(resolver.resolveAll).toHaveBeenCalledTimes(2);
    expect(resolver.resolveAll).toHaveBeenNthCalledWith(1, "src/a.ts", [{ id: "a" }], expect.any(Object));
    expect(resolver.resolveAll).toHaveBeenNthCalledWith(2, "src/b.ts", [{ id: "b" }], expect.any(Object));
    expect(result.dryRun).toBe(true);
  });
});
