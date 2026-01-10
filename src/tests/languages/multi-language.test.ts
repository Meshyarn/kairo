import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { initAstManager, loadFixture } from "./helpers.js";
import { AstManager } from "../../ast/AstManager.js";

describe("Language support: multi-language smoke", () => {
  let manager: AstManager;

  beforeAll(async () => {
    manager = await initAstManager();
  });

  afterAll(async () => {
    await AstManager.resetForTestingAsync();
  });

  it("parses multiple languages without throwing", async () => {
    const samples = [
      { filePath: "sample.ts", content: loadFixture("typescript", "valid.ts") },
      { filePath: "sample.py", content: loadFixture("python", "valid.py") },
      { filePath: "sample.go", content: loadFixture("go", "valid.go") },
      { filePath: "sample.rs", content: loadFixture("rust", "valid.rs") },
      { filePath: "Sample.java", content: loadFixture("java", "valid.java") },
      { filePath: "sample.php", content: loadFixture("php", "valid.php") },
      { filePath: "README.md", content: loadFixture("markdown", "valid.md") }
    ];

    for (const sample of samples) {
      const doc = await manager.parseFile(sample.filePath, sample.content);
      try {
        const skeleton = await manager.generateUniversalSkeleton(sample.filePath, sample.content);
        expect(skeleton.length).toBeGreaterThan(0);
      } finally {
        doc.dispose?.();
      }
    }
  });
});
