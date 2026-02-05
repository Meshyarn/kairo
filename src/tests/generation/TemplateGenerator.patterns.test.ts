import { describe, it, expect, beforeEach } from "@jest/globals";
import type { AdvancedTemplateContext } from "../../generation/TemplateGenerator.js";
import type { ProjectPatterns } from "../../generation/PatternExtractor.js";
import { createTemplateGeneratorFixture } from "./TemplateGeneratorTestUtils.js";

describe("TemplateGenerator patterns", () => {
  let generator: ReturnType<typeof createTemplateGeneratorFixture>["generator"];

  beforeEach(() => {
    ({ generator } = createTemplateGeneratorFixture());
  });

  describe("Pattern-based Generation", () => {
    it("should apply naming conventions from patterns", () => {
      const patterns: ProjectPatterns = {
        imports: [],
        exports: [],
        naming: [
          {
            type: "function",
            convention: "camelCase",
            confidence: 0.95,
            samples: ["calculateTotal", "processData"],
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

      expect(result.code).toContain("function processUserData");
    });

    it("should preserve original name when no pattern exists", () => {
      const patterns: ProjectPatterns = {
        imports: [],
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
        name: "customFunction",
        usePatterns: true,
        patterns,
      };

      const result = generator.generateAdvanced("function", context);

      expect(result.code).toContain("function customFunction");
    });

    it("should extract common imports from patterns", () => {
      const patterns: ProjectPatterns = {
        imports: [
          {
            module: "react",
            style: "default",
            alias: "React",
            count: 10,
          },
          {
            module: "lodash",
            style: "named",
            namedImports: ["map", "filter"],
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
        name: "MyComponent",
        usePatterns: true,
        patterns,
      };

      const result = generator.generateAdvanced("class", context);

      expect(result.imports.length).toBeGreaterThan(0);
      expect(result.imports[0]).toContain("React");
    });
  });
});
