import { TemplateGenerator } from "../../generation/TemplateGenerator.js";
import type { CodeStyle } from "../../generation/StyleInference.js";

export const createTemplateGeneratorFixture = () => {
  const style: CodeStyle = {
    indent: "spaces",
    indentSize: 2,
    quotes: "single",
    semicolons: true,
    lineEndings: "lf",
    trailingComma: true,
  };

  const generator = new TemplateGenerator(style);
  return { generator, style };
};
