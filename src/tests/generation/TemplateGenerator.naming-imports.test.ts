import { describe, it, expect, beforeEach } from "@jest/globals";
import type { AdvancedTemplateContext } from "../../generation/TemplateGenerator.js";
import type { ProjectPatterns } from "../../generation/PatternExtractor.js";
import { createTemplateGeneratorFixture } from "./TemplateGeneratorTestUtils.js";

describe("TemplateGenerator naming and imports", () => {
  let generator: ReturnType<typeof createTemplateGeneratorFixture>["generator"];

  beforeEach(() => {
    ({ generator } = createTemplateGeneratorFixture());
  });

  describe("Naming Convention Conversion", () => {
    it("should convert to camelCase", () => {
      const patterns: ProjectPatterns = {
        imports: [],
        exports: [],
        naming: [
          {
            type: "function",
            convention: "camelCase",
            confidence: 1.0,
            samples: [],
          },
        ],
        fileOrg: {
          fileNamePattern: "*.ts",
          directoryPattern: "src",
        },
        affixes: {
          prefixes: [],
          suffixes: [],
        },
      };

      const context: AdvancedTemplateContext = {
        name: "ProcessUserData",
        usePatterns: true,
        patterns,
      };

      const result = generator.generateAdvanced("function", context);

      expect(result.code).toContain("processUserData");
    });

    it("should convert to PascalCase", () => {
      const patterns: ProjectPatterns = {
        imports: [],
        exports: [],
        naming: [
          {
            type: "class",
            convention: "PascalCase",
            confidence: 1.0,
            samples: [],
          },
        ],
        fileOrg: {
          fileNamePattern: "*.ts",
          directoryPattern: "src",
        },
        affixes: {
          prefixes: [],
          suffixes: [],
        },
      };

      const context: AdvancedTemplateContext = {
        name: "user_service",
        usePatterns: true,
        patterns,
      };

      const result = generator.generateAdvanced("class", context);

      expect(result.code).toContain("class UserService");
    });

    it("should convert to snake_case", () => {
      const patterns: ProjectPatterns = {
        imports: [],
        exports: [],
        naming: [
          {
            type: "function",
            convention: "snake_case",
            confidence: 1.0,
            samples: [],
          },
        ],
        fileOrg: {
          fileNamePattern: "*.ts",
          directoryPattern: "src",
        },
        affixes: {
          prefixes: [],
          suffixes: [],
        },
      };

      const context: AdvancedTemplateContext = {
        name: "ProcessUserData",
        usePatterns: true,
        patterns,
      };

      const result = generator.generateAdvanced("function", context);

      expect(result.code).toContain("process_user_data");
    });
  });

  describe("Fallback to Simple Generation", () => {
    it("should fall back to SimpleTemplateGenerator when patterns not used", () => {
      const context: AdvancedTemplateContext = {
        name: "simpleFunction",
        returnType: "void",
      };

      const result = generator.generateAdvanced("function", context);

      expect(result.code).toContain("function simpleFunction");
      expect(result.imports).toEqual([]);
    });

    it("should apply variable substitution even without patterns", () => {
      const context: AdvancedTemplateContext = {
        name: "greet",
        variables: {
          message: "Hello",
        },
      };

      const result = generator.generateAdvanced("function", context);

      expect(result.code).toContain("function greet");
    });
  });

  describe("Import Formatting", () => {
    it("should format default imports correctly", () => {
      const patterns: ProjectPatterns = {
        imports: [
          {
            module: "react",
            style: "default",
            alias: "React",
            count: 5,
          },
        ],
        exports: [],
        naming: [],
        fileOrg: {
          fileNamePattern: "*.ts",
          directoryPattern: "src",
        },
        affixes: {
          prefixes: [],
          suffixes: [],
        },
      };

      const context: AdvancedTemplateContext = {
        name: "Component",
        usePatterns: true,
        patterns,
      };

      const result = generator.generateAdvanced("class", context);

      expect(result.imports).toContain("import React from 'react';");
    });

    it("should format named imports correctly", () => {
      const patterns: ProjectPatterns = {
        imports: [
          {
            module: "lodash",
            style: "named",
            namedImports: ["map", "filter"],
            count: 4,
          },
        ],
        exports: [],
        naming: [],
        fileOrg: {
          fileNamePattern: "*.ts",
          directoryPattern: "src",
        },
        affixes: {
          prefixes: [],
          suffixes: [],
        },
      };

      const context: AdvancedTemplateContext = {
        name: "Utils",
        usePatterns: true,
        patterns,
      };

      const result = generator.generateAdvanced("class", context);

      expect(result.imports).toContain("import { map, filter } from 'lodash';");
    });

    it("should format namespace imports correctly", () => {
      const patterns: ProjectPatterns = {
        imports: [
          {
            module: "fs",
            style: "namespace",
            alias: "fs",
            count: 3,
          },
        ],
        exports: [],
        naming: [],
        fileOrg: {
          fileNamePattern: "*.ts",
          directoryPattern: "src",
        },
        affixes: {
          prefixes: [],
          suffixes: [],
        },
      };

      const context: AdvancedTemplateContext = {
        name: "FileHandler",
        usePatterns: true,
        patterns,
      };

      const result = generator.generateAdvanced("class", context);

      expect(result.imports).toContain("import * as fs from 'fs';");
    });
  });
});
