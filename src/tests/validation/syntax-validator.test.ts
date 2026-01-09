import { describe, expect, it } from "@jest/globals";
import { SyntaxValidator } from "../../engine/validators/syntax-validator.js";

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
});
