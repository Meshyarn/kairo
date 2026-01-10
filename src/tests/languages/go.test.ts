import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { initAstManager, createBackend, loadFixture, loadExpected, validateSyntax } from "./helpers.js";
import { getSupportForLanguageId } from "../../config/LanguageSupportLevels.js";
import { AstManager } from "../../ast/AstManager.js";

describe("Language support: Go", () => {
  let manager: AstManager;

  beforeAll(async () => {
    manager = await initAstManager();
  });

  afterAll(async () => {
    await AstManager.resetForTestingAsync();
  });

  it("extracts imports/symbols and skeleton", async () => {
    const content = loadFixture("go", "valid.go");
    const expected = loadExpected("go");
    const backend = await createBackend(manager);
    const doc = await manager.parseFile("sample.go", content);

    try {
      const languageId = manager.getLanguageId("sample.go");
      const imports = await backend.extractImports({ filePath: "sample.go", content, languageId, doc });
      const symbols = await backend.extractSymbols({ filePath: "sample.go", content, languageId, doc });
      const skeleton = await manager.generateUniversalSkeleton("sample.go", content);

      expect(getSupportForLanguageId(languageId)?.level).toBe("edit-safe");
      expected.imports?.forEach((specifier) => {
        expect(imports.map((entry) => entry.specifier)).toContain(specifier);
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
    const content = loadFixture("go", "syntax-error.go");
    const issues = await validateSyntax("broken.go", content);
    expect(issues.length).toBeGreaterThan(0);
  });
});
