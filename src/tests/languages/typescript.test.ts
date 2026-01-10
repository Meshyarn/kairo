import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { initAstManager, createBackend, loadFixture, loadExpected, validateSyntax } from "./helpers.js";
import { getSupportForLanguageId } from "../../config/LanguageSupportLevels.js";
import { AstManager } from "../../ast/AstManager.js";

describe("Language support: TypeScript", () => {
  let manager: AstManager;

  beforeAll(async () => {
    manager = await initAstManager();
  });

  afterAll(async () => {
    await AstManager.resetForTestingAsync();
  });

  it("extracts imports/exports/symbols and skeleton", async () => {
    const content = loadFixture("typescript", "valid.ts");
    const expected = loadExpected("typescript");
    const backend = await createBackend(manager);
    const doc = await manager.parseFile("sample.ts", content);

    try {
      const languageId = manager.getLanguageId("sample.ts");
      const imports = await backend.extractImports({ filePath: "sample.ts", content, languageId, doc });
      const exports = await backend.extractExports({ filePath: "sample.ts", content, languageId, doc });
      const symbols = await backend.extractSymbols({ filePath: "sample.ts", content, languageId, doc });
      const skeleton = await manager.generateUniversalSkeleton("sample.ts", content);

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
    const content = loadFixture("typescript", "syntax-error.ts");
    const issues = await validateSyntax("broken.ts", content);
    expect(issues.length).toBeGreaterThan(0);
  });
});
