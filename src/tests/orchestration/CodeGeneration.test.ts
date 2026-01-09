import { describe, it, expect, jest } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { OrchestrationContext } from "../../orchestration/OrchestrationContext.js";
import {
  smartWriteCode,
  quickGenerateCode,
  resolveTemplateContent
} from "../../orchestration/pillars/write/CodeGeneration.js";

const makeTempDir = (): string => {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kairo-codegen-"));
};

describe("CodeGeneration", () => {
  jest.setTimeout(60000);
  it("quickGenerateCode returns a template", async () => {
    const result = await quickGenerateCode(
      "src/generated.ts",
      "create function greet returns string",
      () => ({ templateType: "function", context: { name: "greet", returnType: "string", export: true } })
    );

    expect(result?.templateType).toBe("function");
    expect(result?.code).toContain("function greet");
  });

  it("smartWriteCode returns generated code when patterns are available", async () => {
    const tempDir = makeTempDir();
    const resolvedPath = path.join(tempDir, "Widget.ts");
    const similarFile = path.join(tempDir, "Sample.ts");
    fs.writeFileSync(similarFile, "export class Sample {}\n", "utf-8");

    const result = await smartWriteCode(
      resolvedPath,
      "create class widget",
      {},
      new OrchestrationContext(),
      async () => ({}),
      () => ({ templateType: "class", context: { name: "Widget" } }),
      [similarFile]
    );

    expect(result?.templateType).toBe("class");
    expect(result?.code).toContain("class");
  });

  it("smartWriteCode returns null when no similar files can be found", async () => {
    const tempDir = makeTempDir();
    const resolvedPath = path.join(tempDir, "Widget.ts");

    const result = await smartWriteCode(
      resolvedPath,
      "create class widget",
      {},
      new OrchestrationContext(),
      async () => {
        throw new Error("search failure");
      },
      () => ({ templateType: "class", context: { name: "Widget" } })
    );

    expect(result).toBeNull();
  });

  it("resolveTemplateContent loads content from path templates", async () => {
    const tempDir = makeTempDir();
    const templatePath = path.join(tempDir, "template.txt");
    fs.writeFileSync(templatePath, "template content", "utf-8");

    const content = await resolveTemplateContent(
      templatePath,
      "src/output.ts",
      "",
      new OrchestrationContext(),
      async (_context, tool, args) => {
        if (tool === "code_read") return fs.readFileSync(args.filePath, "utf-8");
        return null;
      },
      (value) => value,
      (value) => value.includes("/")
    );

    expect(content).toBe("template content");
  });

  it("resolveTemplateContent supports test/class/readme/default templates", async () => {
    const toPascal = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
    const context = new OrchestrationContext();
    const readme = await resolveTemplateContent(
      "readme",
      "docs/Guide.md",
      "Intro",
      context,
      async () => null,
      toPascal,
      () => false
    );
    expect(readme).toContain("# Guide");

    const testTemplate = await resolveTemplateContent(
      "jest test",
      "src/widget.ts",
      "",
      context,
      async () => null,
      toPascal,
      () => false
    );
    expect(testTemplate).toContain("describe(\"Widget\"");

    const classTemplate = await resolveTemplateContent(
      "class",
      "src/widget.js",
      "",
      context,
      async () => null,
      toPascal,
      () => false
    );
    expect(classTemplate).toContain("class Widget");

    const fallback = await resolveTemplateContent(
      "custom",
      "src/widget.ts",
      "",
      context,
      async () => null,
      toPascal,
      () => false
    );
    expect(fallback).toBe("// Template: custom\n");
  });
});
