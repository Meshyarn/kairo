import { describe, expect, it } from "@jest/globals";
import { SyntaxValidator } from "../../engine/validators/syntax-validator.js";
import { RustSyntaxValidator } from "../../engine/validators/RustSyntaxValidator.js";

describe("SyntaxValidator", () => {
  it("accepts valid code", async () => {
    const validator = new SyntaxValidator();
    const result = await validator.validate(
      "tmp/valid-syntax.ts",
      [
        "function greet(name: string) {",
        "  return name.toUpperCase();",
        "}",
        ""
      ].join("\n")
    );

    expect(result.success).toBe(true);
    expect(result.blockingErrors?.length ?? 0).toBe(0);
  });

  it("rejects code with syntax errors", async () => {
    const validator = new SyntaxValidator();
    const result = await validator.validate(
      "tmp/invalid-syntax.ts",
      [
        "function greet(name: string) {",
        "  if (name {",
        "    return name.toUpperCase();",
        "  }",
        "}",
        ""
      ].join("\n")
    );

    expect(result.success).toBe(false);
    expect((result.blockingErrors ?? []).length).toBeGreaterThan(0);
  });

  it("checks syntax with Rust validator when available", () => {
    const rustValidator = RustSyntaxValidator.getShared();
    if (!rustValidator.isAvailable()) {
      return;
    }
    const issues = rustValidator.validate(
      "ts",
      [
        "function greet(name: string) {",
        "  if (name {",
        "    return name.toUpperCase();",
        "  }",
        "}",
        ""
      ].join("\n")
    );
    expect(issues.length).toBeGreaterThan(0);
  });
});
