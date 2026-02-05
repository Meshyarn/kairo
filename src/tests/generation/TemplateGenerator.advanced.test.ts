import { describe, it, expect, beforeEach } from "@jest/globals";
import type { AdvancedTemplateContext } from "../../generation/TemplateGenerator.js";
import { createTemplateGeneratorFixture } from "./TemplateGeneratorTestUtils.js";

describe("TemplateGenerator advanced", () => {
  let generator: ReturnType<typeof createTemplateGeneratorFixture>["generator"];

  beforeEach(() => {
    ({ generator } = createTemplateGeneratorFixture());
  });

  describe("Advanced Function Generation", () => {
    it("should generate function with custom template", () => {
      const customTemplate = `function {{name}}() {
  console.log('{{message}}');
}`;

      const context: AdvancedTemplateContext = {
        name: "greet",
        variables: {
          message: "Hello, World!",
        },
      };

      const result = generator.generateFunctionWithTemplate(context, customTemplate);

      expect(result.code).toContain("function greet");
      expect(result.code).toContain("console.log('Hello, World!')");
    });

    it("should use default function template when no custom template provided", () => {
      const context: AdvancedTemplateContext = {
        name: "calculate",
        description: "Performs calculation",
        export: true,
        async: true,
        returnType: "Promise<number>",
      };

      const result = generator.generateFunctionWithTemplate(context);

      expect(result.code).toContain("/**");
      expect(result.code).toContain("Performs calculation");
      expect(result.code).toContain("export async function calculate");
      expect(result.code).toContain("Promise<number>");
    });
  });

  describe("Advanced Class Generation", () => {
    it("should generate class with custom template", () => {
      const customTemplate = `class {{name}} {
{{#properties}}
  {{name}}: {{type}};
{{/properties}}
}`;

      const context: AdvancedTemplateContext = {
        name: "User",
        variables: {
          properties: [
            { name: "id", type: "string" },
            { name: "name", type: "string" },
          ],
        },
      };

      const result = generator.generateClassWithTemplate(context, customTemplate);

      expect(result.code).toContain("class User");
      expect(result.code).toContain("id: string");
      expect(result.code).toContain("name: string");
    });

    it("should use default class template when no custom template provided", () => {
      const context: AdvancedTemplateContext = {
        name: "Service",
        description: "Main service class",
        export: true,
        extends: "BaseService",
        properties: [
          { name: "config", type: "Config", visibility: "private" },
        ],
        methods: [
          { name: "initialize", returnType: "void" },
        ],
      };

      const result = generator.generateClassWithTemplate(context);

      expect(result.code).toContain("/**");
      expect(result.code).toContain("Main service class");
      expect(result.code).toContain("export class Service extends BaseService");
      expect(result.code).toContain("private config: Config");
      expect(result.code).toContain("initialize(): void");
    });
  });
});
