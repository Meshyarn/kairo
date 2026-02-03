import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { IFileSystem } from "../../platform/FileSystem.js";
import { createPatternExtractorFixture } from "./PatternExtractorTestUtils.js";

describe("PatternExtractor import/export", () => {
  let mockFileSystem: IFileSystem;
  let extractor: ReturnType<typeof createPatternExtractorFixture>["extractor"];

  beforeEach(() => {
    ({ mockFileSystem, extractor } = createPatternExtractorFixture());
  });

  describe("Import Pattern Extraction", () => {
    it("should extract named import patterns", async () => {
      const fileContent = `
import { foo, bar } from 'moduleA';
import { baz } from 'moduleB';
import { foo, bar } from 'moduleA';
import { baz } from 'moduleB';
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/file1.ts"]);

      expect(patterns.imports).toHaveLength(2);

      const moduleAImport = patterns.imports.find(p => p.module === "moduleA");
      expect(moduleAImport).toBeDefined();
      expect(moduleAImport?.style).toBe("named");
      expect(moduleAImport?.count).toBe(2);
      expect(moduleAImport?.namedImports).toEqual(["foo", "bar"]);
    });

    it("should extract default import patterns", async () => {
      const fileContent = `
import React from 'react';
import fs from 'fs';
import React from 'react';
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/file1.ts"]);

      const reactImport = patterns.imports.find(p => p.module === "react");
      expect(reactImport).toBeDefined();
      expect(reactImport?.style).toBe("default");
      expect(reactImport?.count).toBe(2);
      expect(reactImport?.alias).toBe("React");
    });

    it("should extract namespace import patterns", async () => {
      const fileContent = `
import * as path from 'path';
import * as fs from 'fs';
import * as path from 'path';
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/file1.ts"]);

      const pathImport = patterns.imports.find(p => p.module === "path");
      expect(pathImport).toBeDefined();
      expect(pathImport?.style).toBe("namespace");
      expect(pathImport?.count).toBe(2);
      expect(pathImport?.alias).toBe("path");
    });

    it("should extract side-effect import patterns", async () => {
      const fileContent = `
import 'reflect-metadata';
import './styles.css';
import 'reflect-metadata';
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/file1.ts"]);

      const metadataImport = patterns.imports.find(p => p.module === "reflect-metadata");
      expect(metadataImport).toBeDefined();
      expect(metadataImport?.style).toBe("side-effect");
      expect(metadataImport?.count).toBe(2);
    });

    it("should filter imports by minimum frequency", async () => {
      const fileContent = `
import { once } from 'moduleA';
import { twice } from 'moduleB';
import { twice } from 'moduleB';
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/file1.ts"]);

      expect(patterns.imports).toHaveLength(1);
      expect(patterns.imports[0].module).toBe("moduleB");
    });
  });

  describe("Export Pattern Extraction", () => {
    it("should extract named export patterns", async () => {
      const fileContent = `
export { foo, bar };
export { baz };
export { foo, bar };
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/file1.ts"]);

      const namedExport = patterns.exports.find(p => p.style === "named");
      expect(namedExport).toBeDefined();
      expect(namedExport?.count).toBeGreaterThanOrEqual(2);
    });

    it("should extract default export patterns", async () => {
      const fileContent = `
export default class MyClass {}
export default function myFunc() {}
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/file1.ts"]);

      const defaultExport = patterns.exports.find(p => p.style === "default");
      expect(defaultExport).toBeDefined();
      expect(defaultExport?.count).toBe(2);
    });

    it("should extract namespace export patterns", async () => {
      const fileContent = `
export * from './moduleA';
export * from './moduleB';
export * from './moduleA';
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/file1.ts"]);

      const namespaceExport = patterns.exports.find(p => p.style === "namespace");
      expect(namespaceExport).toBeDefined();
      expect(namespaceExport?.count).toBeGreaterThanOrEqual(2);
    });
  });
});
