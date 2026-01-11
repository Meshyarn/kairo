import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { initAstManager, createBackend, loadFixture, loadExpected } from "./helpers.js";
import { getSupportForLanguageId } from "../../config/LanguageSupportLevels.js";
import { AstManager } from "../../ast/AstManager.js";

describe("Language support: Markdown", () => {
  let manager: AstManager;

  beforeAll(async () => {
    manager = await initAstManager();
  });

  afterAll(async () => {
    await AstManager.resetForTestingAsync();
  });

  it("extracts imports/symbols and skeleton", async () => {
    const content = loadFixture("markdown", "valid.md");
    const expected = loadExpected("markdown");
    const backend = await createBackend(manager);
    const doc = await manager.parseFile("README.md", content);

    try {
      const languageId = manager.getLanguageId("README.md");
      const imports = await backend.extractImports({ filePath: "README.md", content, languageId, doc });
      const symbols = await backend.extractSymbols({ filePath: "README.md", content, languageId, doc });
      const skeleton = await manager.generateUniversalSkeleton("README.md", content);

      expect(getSupportForLanguageId(languageId)?.level).toBe("understand-grade");
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

});
