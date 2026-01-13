import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { initAstManager, createBackend, loadFixture, loadExpected, validateSyntax } from "./helpers.js";
import { getSupportForLanguageId } from "../../config/LanguageSupportLevels.js";
import { AstManager } from "../../ast/AstManager.js";

describe("Language support: PHP", () => {
  let manager: AstManager;

  beforeAll(async () => {
    manager = await initAstManager();
  });

  afterAll(async () => {
    await AstManager.resetForTestingAsync();
  });

  it("extracts imports/exports/symbols and skeleton", async () => {
    const content = loadFixture("php", "valid.php");
    const expected = loadExpected("php");
    const backend = await createBackend(manager);
    const doc = await manager.parseFile("sample.php", content);

    try {
      const languageId = manager.getLanguageId("sample.php");
      const imports = await backend.extractImports({ filePath: "sample.php", content, languageId, doc });
      const exports = await backend.extractExports({ filePath: "sample.php", content, languageId, doc });
      const symbols = await backend.extractSymbols({ filePath: "sample.php", content, languageId, doc });
      const skeleton = await manager.generateUniversalSkeleton("sample.php", content);

      expect(getSupportForLanguageId(languageId)?.level).toBe("L3");
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
    const content = loadFixture("php", "syntax-error.php");
    const issues = await validateSyntax("broken.php", content);
    expect(issues.length).toBeGreaterThan(0);
  });
});
