import { describe, it, expect } from "@jest/globals";
import { LANGUAGE_PARITY_MATRIX } from "../../config/LanguageParityMatrix.js";

describe("LanguageParityMatrix", () => {
  it("exposes the expected language set", () => {
    const ids = LANGUAGE_PARITY_MATRIX.languages.map((entry) => entry.languageId);
    expect(ids).toEqual(
      expect.arrayContaining([
        "typescript",
        "python",
        "go",
        "rust",
        "java",
        "php",
        "sql",
        "markdown",
        "c",
        "cpp",
        "c_sharp"
      ])
    );
  });

  it("marks typescript aliases for parity checks", () => {
    const ts = LANGUAGE_PARITY_MATRIX.languages.find((entry) => entry.languageId === "typescript");
    expect(ts?.aliases).toEqual(expect.arrayContaining(["tsx", "javascript"]));
  });

  it("requires syntax validation for L3 languages", () => {
    const l3 = LANGUAGE_PARITY_MATRIX.languages.filter((entry) => entry.supportLevel === "L3");
    expect(l3.length).toBeGreaterThan(0);
    expect(l3.every((entry) => entry.requiredSyntaxValidator)).toBe(true);
  });
});
