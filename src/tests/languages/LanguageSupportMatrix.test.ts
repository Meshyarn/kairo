import { jest } from "@jest/globals";
import { AstManager } from "../../ast/AstManager.js";
import { TreeSitterBackend } from "../../ast/extraction/backends/TreeSitterBackend.js";

jest.setTimeout(20000);

describe("Language support matrix (Phase C)", () => {
  let manager: AstManager;
  let backend: TreeSitterBackend;

  beforeAll(async () => {
    AstManager.resetForTesting();
    manager = AstManager.getInstance();
    await manager.init({ mode: "test", parserBackend: "wasm" });
    backend = new TreeSitterBackend(manager.getQueryProvider());
  });

  afterAll(async () => {
    await AstManager.resetForTestingAsync();
  });

  it("extracts Java imports/exports/symbols", async () => {
    const content = `
package com.example;
import java.util.List;
public class Foo {
  public void bar() {}
}
`;
    const doc = await manager.parseFile("Sample.java", content);
    try {
      const languageId = manager.getLanguageId("Sample.java");
      const imports = await backend.extractImports({ filePath: "Sample.java", content, languageId, doc });
      const exports = await backend.extractExports({ filePath: "Sample.java", content, languageId, doc });
      const symbols = await backend.extractSymbols({ filePath: "Sample.java", content, languageId, doc });

      expect(imports.length).toBeGreaterThan(0);
      expect(exports.some((entry) => entry.name === "Foo")).toBe(true);
      expect(symbols.some((symbol) => symbol.name === "Foo")).toBe(true);
    } finally {
      doc.dispose?.();
    }
  });

  it("extracts PHP imports/exports/symbols", async () => {
    const content = `
<?php
namespace App;
use App\\Utils\\Helper;
class Foo {
  public function bar() {}
}
function baz() {}
`;
    const doc = await manager.parseFile("sample.php", content);
    try {
      const languageId = manager.getLanguageId("sample.php");
      const imports = await backend.extractImports({ filePath: "sample.php", content, languageId, doc });
      const exports = await backend.extractExports({ filePath: "sample.php", content, languageId, doc });
      const symbols = await backend.extractSymbols({ filePath: "sample.php", content, languageId, doc });

      expect(imports.length).toBeGreaterThan(0);
      expect(exports.some((entry) => entry.name === "Foo")).toBe(true);
      expect(exports.some((entry) => entry.name === "baz")).toBe(true);
      expect(symbols.some((symbol) => symbol.name === "Foo")).toBe(true);
    } finally {
      doc.dispose?.();
    }
  });

  it("extracts SQL symbols and skeletons", async () => {
    const content = `
CREATE TABLE users (id INT);
CREATE VIEW active_users AS SELECT * FROM users;
`;
    const doc = await manager.parseFile("schema.sql", content);
    try {
      const languageId = manager.getLanguageId("schema.sql");
      const symbols = await backend.extractSymbols({ filePath: "schema.sql", content, languageId, doc });
      const skeleton = await manager.generateUniversalSkeleton("schema.sql", content);

      expect(symbols.length).toBeGreaterThan(0);
      expect(skeleton.toLowerCase()).toContain("create table");
    } finally {
      doc.dispose?.();
    }
  });
});
