import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { initAstManager, createBackend, loadFixture, loadExpected, validateSyntax } from "./helpers.js";
import { getSupportForLanguageId } from "../../config/LanguageSupportLevels.js";
import { AstManager } from "../../ast/AstManager.js";

describe("Language support: Java", () => {
  let manager: AstManager;

  beforeAll(async () => {
    manager = await initAstManager();
  });

  afterAll(async () => {
    await AstManager.resetForTestingAsync();
  });

  it("extracts imports/exports/symbols and skeleton", async () => {
    const content = loadFixture("java", "valid.java");
    const expected = loadExpected("java");
    const backend = await createBackend(manager);
    const doc = await manager.parseFile("Sample.java", content);

    try {
      const languageId = manager.getLanguageId("Sample.java");
      const imports = await backend.extractImports({ filePath: "Sample.java", content, languageId, doc });
      const exports = await backend.extractExports({ filePath: "Sample.java", content, languageId, doc });
      const symbols = await backend.extractSymbols({ filePath: "Sample.java", content, languageId, doc });
      const skeleton = await manager.generateUniversalSkeleton("Sample.java", content);

      expect(getSupportForLanguageId(languageId)?.level).toBe("edit-safe");
      expected.imports?.forEach((specifier) => {
        expect(imports.map((entry) => entry.specifier)).toContain(specifier);
      });
      expected.exports?.forEach((name) => {
        expect(exports.map((entry) => entry.name)).toContain(name);
      });
      expected.symbols?.forEach((name) => {
        expect(symbols.map((entry) => entry.name)).toContain(name);
      });
      expected.skeletonIncludes?.forEach((snippet) => {
        expect(skeleton).toContain(snippet);
      });
    } finally {
      doc.dispose?.();
    }
  });

  it("detects syntax errors", async () => {
    const content = loadFixture("java", "syntax-error.java");
    const issues = await validateSyntax("Broken.java", content);
    expect(issues.length).toBeGreaterThan(0);
  });
});
