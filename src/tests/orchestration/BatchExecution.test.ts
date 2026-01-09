import { describe, it, expect } from "@jest/globals";
import { OrchestrationContext } from "../../orchestration/OrchestrationContext.js";
import { executeBatchChange } from "../../orchestration/pillars/change/BatchExecution.js";

const intent = {
  originalIntent: "update files",
  constraints: { batchImpactLimit: 5 }
} as any;

describe("BatchExecution", () => {
  it("fails when no edits are provided", async () => {
    const result = await executeBatchChange(
      {
        intent,
        context: new OrchestrationContext(),
        rawEdits: [],
        targetFiles: [],
        dryRun: true,
        includeImpact: false
      },
      async () => ({}),
      () => undefined,
      () => ({ message: "fail", suggestedActions: [] })
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("No edits provided");
  });

  it("returns mapping errors when file paths are missing", async () => {
    const result = await executeBatchChange(
      {
        intent,
        context: new OrchestrationContext(),
        rawEdits: [{ targetString: "a" }],
        targetFiles: [],
        dryRun: true,
        includeImpact: false
      },
      async () => ({}),
      () => undefined,
      () => ({ message: "fail", suggestedActions: [] })
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("MULTI_FILE_MAPPING_REQUIRED");
  });

  it("rejects invalid normalized edits", async () => {
    const result = await executeBatchChange(
      {
        intent,
        context: new OrchestrationContext(),
        rawEdits: [{ filePath: "src/a.ts", operation: "insert", insertMode: "at" }],
        targetFiles: ["src/a.ts"],
        dryRun: true,
        includeImpact: false
      },
      async () => ({}),
      (edit) => edit.filePath,
      () => ({ message: "fail", suggestedActions: [] })
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("No valid edits provided");
  });

  it("successfully performs a dry run", async () => {
    const runTool = async (context: any, tool: string, args: any) => {
      if (tool === 'edit_transaction') {
        return { success: true, diff: "some diff", impactPreview: { score: 0.5 } };
      }
      return {};
    };

    const result = await executeBatchChange(
      {
        intent,
        context: new OrchestrationContext(),
        rawEdits: [{ filePath: "src/a.ts", targetString: "a", replacement: "b" }],
        targetFiles: ["src/a.ts"],
        dryRun: true,
        includeImpact: true
      },
      runTool,
      (edit) => edit.filePath,
      () => ({ message: "fail", suggestedActions: [] })
    );

    expect(result.success).toBe(true);
    expect(result.operation).toBe("plan");
    expect(result.diff).toContain("src/a.ts");
    expect(result.impactReports).toHaveLength(1);
  });

  it("handles dry run failure", async () => {
    const runTool = async (context: any, tool: string, args: any) => {
      if (tool === 'edit_transaction') {
        return { success: false, message: "edit failed" };
      }
      return {};
    };

    const result = await executeBatchChange(
      {
        intent,
        context: new OrchestrationContext(),
        rawEdits: [{ filePath: "src/a.ts", targetString: "a", replacement: "b" }],
        targetFiles: ["src/a.ts"],
        dryRun: true,
        includeImpact: false
      },
      runTool,
      (edit) => edit.filePath,
      (args) => ({ message: args.failureMessage, suggestedActions: [] })
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("Dry run failed for file src/a.ts: edit failed");
  });

  it("successfully performs an apply", async () => {
    const runTool = async (context: any, tool: string, args: any) => {
      if (tool === 'edit_apply') {
        return { success: true, results: [{ filePath: "src/a.ts", applied: true }], operation: { id: "tx1" } };
      }
      if (tool === 'impact_analyze') {
        return { score: 0.5 };
      }
      return {};
    };

    const result = await executeBatchChange(
      {
        intent,
        context: new OrchestrationContext(),
        rawEdits: [{ filePath: "src/a.ts", targetString: "a", replacement: "b" }],
        targetFiles: ["src/a.ts"],
        dryRun: false,
        includeImpact: true
      },
      runTool,
      (edit) => edit.filePath,
      () => ({})
    );

    expect(result.success).toBe(true);
    expect(result.operation).toBe("apply");
    expect(result.transactionId).toBe("tx1");
    expect(result.impactReports).toHaveLength(1);
  });

  it("handles apply failure", async () => {
    const runTool = async (context: any, tool: string, args: any) => {
      if (tool === 'edit_apply') {
        return { success: false, message: "apply failed" };
      }
      return {};
    };

    const result = await executeBatchChange(
      {
        intent,
        context: new OrchestrationContext(),
        rawEdits: [{ filePath: "src/a.ts", targetString: "a", replacement: "b" }],
        targetFiles: ["src/a.ts"],
        dryRun: false,
        includeImpact: false
      },
      runTool,
      (edit) => edit.filePath,
      () => ({})
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe("apply failed");
  });
});
