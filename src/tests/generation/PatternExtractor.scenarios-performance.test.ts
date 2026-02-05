import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { IFileSystem } from "../../platform/FileSystem.js";
import { createPatternExtractorFixture } from "./PatternExtractorTestUtils.js";

describe("PatternExtractor scenarios and performance", () => {
  let mockFileSystem: IFileSystem;
  let extractor: ReturnType<typeof createPatternExtractorFixture>["extractor"];

  beforeEach(() => {
    ({ mockFileSystem, extractor } = createPatternExtractorFixture());
  });

  describe("Real-World Scenarios", () => {
    it("should extract patterns from React component files", async () => {
      const fileContent = `
import React from 'react';
import { useState, useEffect } from 'react';
import { useState, useEffect } from 'react';
import { MyComponent } from './components/MyComponent';

export interface Props {
    title: string;
    count: number;
}

export function myButton(props: Props) {
    const [isClicked, setIsClicked] = useState(false);
    
    return <button>{props.title}</button>;
}

export default myButton;
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/Button.tsx"]);

      const reactImport = patterns.imports.find(p => p.module === "react");
      expect(reactImport).toBeDefined();

      const interfacePattern = patterns.naming.find(p => p.type === "interface");
      expect(interfacePattern?.convention).toBe("PascalCase");

      const funcPattern = patterns.naming.find(p => p.type === "function");
      expect(funcPattern?.convention).toBe("camelCase");
    });

    it("should extract patterns from Node.js service files", async () => {
      const fileContent = `
import * as fs from 'fs';
import * as path from 'path';
import * as path from 'path';
import { DatabaseConnection } from './database';

export class UserService {
    private readonly db: DatabaseConnection;
    
    constructor(db: DatabaseConnection) {
        this.db = db;
    }
    
    async getUserById(id: string) {
        return this.db.query('SELECT * FROM users WHERE id = ?', [id]);
    }
}

export default UserService;
      `;

      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue(fileContent);

      const patterns = await extractor.extractPatterns(["/test/UserService.ts"]);

      const namespaceImports = patterns.imports.filter(p => p.style === "namespace");
      expect(namespaceImports.length).toBeGreaterThan(0);

      const classPattern = patterns.naming.find(p => p.type === "class");
      expect(classPattern?.convention).toBe("PascalCase");

      const funcPattern = patterns.naming.find(p => p.type === "function");
      if (funcPattern) {
        expect(funcPattern.convention).toBe("camelCase");
      }
    });
  });

  describe("Performance", () => {
    it("should handle large number of files efficiently", async () => {
      (mockFileSystem.readFile as jest.Mock<() => Promise<string>>).mockResolvedValue('import { foo } from "bar";');

      const files = Array.from({ length: 100 }, (_, i) => `/test/file${i}.ts`);

      const startTime = Date.now();
      await extractor.extractPatterns(files);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(1000);
    });
  });
});
