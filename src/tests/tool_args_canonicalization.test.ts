import { describe, it, expect } from "@jest/globals";
import { createDefaultToolSpecRegistry } from "../server/tools/ToolSpecRegistry.js";
import { normalizeArgs } from "../server/tools/ToolArgs.js";

describe("Tool args canonicalization v2", () => {
  const registry = createDefaultToolSpecRegistry();

  it("maps max_tokens to limits.maxTokens and coerces numbers", () => {
    const toolSpec = registry.get("explore");
    if (!toolSpec) throw new Error("Missing explore tool spec");

    const { args, findings } = normalizeArgs(toolSpec, { query: "q", max_tokens: "6000" }, "compat");

    expect(args.limits?.maxTokens).toBe(6000);
    expect(args.max_tokens).toBeUndefined();
    expect(findings.some((finding) => finding.code === "SCHEMA_ALIAS_USED")).toBe(true);
    expect(findings.some((finding) => finding.code === "COERCION_APPLIED")).toBe(true);
  });

  it("maps files to targetFiles for change", () => {
    const toolSpec = registry.get("change");
    if (!toolSpec) throw new Error("Missing change tool spec");

    const { args } = normalizeArgs(toolSpec, { intent: "update", files: ["src/app.ts"] }, "compat");

    expect(args.targetFiles).toEqual(["src/app.ts"]);
    expect(args.files).toBeUndefined();
  });

  it("maps dryRun to safety for task", () => {
    const toolSpec = registry.get("task");
    if (!toolSpec) throw new Error("Missing task tool spec");

    const { args } = normalizeArgs(toolSpec, { request: "summarize", dryRun: true }, "compat");

    expect(args.safety).toBe("plan");
    expect(args.dryRun).toBeUndefined();
  });

  it("coerces string arrays and booleans based on schema", () => {
    const toolSpec = registry.get("explore");
    if (!toolSpec) throw new Error("Missing explore tool spec");

    const { args } = normalizeArgs(toolSpec, { query: "q", paths: "src", trace: "true" }, "compat");

    expect(args.paths).toEqual(["src"]);
    expect(args.trace).toBe(true);
  });

  it("maps contentBase64 to contentSource for write", () => {
    const toolSpec = registry.get("write");
    if (!toolSpec) throw new Error("Missing write tool spec");

    const base64 = Buffer.from("hello").toString("base64");
    const { args, findings } = normalizeArgs(toolSpec, { intent: "create", contentBase64: base64 }, "compat");

    expect(args.contentSource).toEqual({ kind: "base64", base64, charset: "utf8" });
    expect(args.contentBase64).toBeUndefined();
    expect(findings.some((finding) => finding.code === "DEPRECATED_FIELD_USED")).toBe(true);
  });

  it("maps edit base64 fields to contentSource for change", () => {
    const toolSpec = registry.get("change");
    if (!toolSpec) throw new Error("Missing change tool spec");

    const base64 = Buffer.from("target").toString("base64");
    const { args, findings } = normalizeArgs(
      toolSpec,
      {
        intent: "update",
        edits: [
          {
            filePath: "src/app.ts",
            targetStringBase64: base64,
            replacementString: "next"
          }
        ]
      },
      "compat"
    );

    expect(args.edits[0].targetSource).toEqual({ kind: "base64", base64, charset: "utf8" });
    expect(args.edits[0].targetStringBase64).toBeUndefined();
    expect(findings.some((finding) => finding.code === "DEPRECATED_FIELD_USED")).toBe(true);
  });
});
