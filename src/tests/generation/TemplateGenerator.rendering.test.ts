import { describe, it, expect, beforeEach } from "@jest/globals";
import type { TemplateVariables } from "../../generation/TemplateGenerator.js";
import { createTemplateGeneratorFixture } from "./TemplateGeneratorTestUtils.js";

describe("TemplateGenerator rendering", () => {
  let generator: ReturnType<typeof createTemplateGeneratorFixture>["generator"];

  beforeEach(() => {
    ({ generator } = createTemplateGeneratorFixture());
  });

  describe("Mustache-like Template Rendering", () => {
    it("should substitute simple variables", () => {
      const template = "Hello {{name}}!";
      const variables: TemplateVariables = { name: "World" };

      const result = generator.renderTemplate(template, variables);

      expect(result).toBe("Hello World!");
    });

    it("should handle conditional blocks", () => {
      const template = "{{#hasFeature}}Feature enabled{{/hasFeature}}";

      const withFeature = generator.renderTemplate(template, { hasFeature: true });
      const withoutFeature = generator.renderTemplate(template, { hasFeature: false });

      expect(withFeature).toBe("Feature enabled");
      expect(withoutFeature).toBe("");
    });

    it("should handle inverted conditionals", () => {
      const template = "{{^hasFeature}}Feature disabled{{/hasFeature}}";

      const withFeature = generator.renderTemplate(template, { hasFeature: true });
      const withoutFeature = generator.renderTemplate(template, { hasFeature: false });

      expect(withFeature).toBe("");
      expect(withoutFeature).toBe("Feature disabled");
    });

    it("should iterate over arrays", () => {
      const template = "{{#items}}Item: {{name}}\n{{/items}}";
      const variables: TemplateVariables = {
        items: [
          { name: "First" },
          { name: "Second" },
          { name: "Third" },
        ],
      };

      const result = generator.renderTemplate(template, variables);

      expect(result).toContain("Item: First");
      expect(result).toContain("Item: Second");
      expect(result).toContain("Item: Third");
    });

    it("should handle primitive arrays with {{.}} syntax", () => {
      const template = "{{#colors}}Color: {{.}}\n{{/colors}}";
      const variables: TemplateVariables = {
        colors: ["Red", "Green", "Blue"],
      };

      const result = generator.renderTemplate(template, variables);

      expect(result).toContain("Color: Red");
      expect(result).toContain("Color: Green");
      expect(result).toContain("Color: Blue");
    });

    it("should handle nested structures", () => {
      const template = "{{#person}}Name: {{name}}, Age: {{age}}{{/person}}";
      const variables: TemplateVariables = {
        person: { name: "Alice", age: 30 },
      };

      const result = generator.renderTemplate(template, variables);

      expect(result).toContain("Name: Alice");
      expect(result).toContain("Age: 30");
    });

    it("should handle missing variables gracefully", () => {
      const template = "Hello {{missing}}!";
      const variables: TemplateVariables = {};

      const result = generator.renderTemplate(template, variables);

      expect(result).toBe("Hello !");
    });
  });
});
