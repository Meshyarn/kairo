import type { BoundaryKind } from "../contracts/boundaries/types.js";

export type SupportLevel = "L2" | "L3";

export type ParityRequirement = {
  languageId: string;
  supportLevel: SupportLevel;
  aliases?: string[];
  requiredQueryPack: boolean;
  requiredWasmGrammar: boolean;
  requiredSyntaxValidator: boolean;
  requiredBoundaries?: BoundaryKind[];
  evidenceGlobs?: string[];
};

export type LanguageParityMatrix = {
  version: "1.0";
  languages: ParityRequirement[];
};

export const LANGUAGE_PARITY_MATRIX: LanguageParityMatrix = {
  version: "1.0",
  languages: [
    {
      languageId: "typescript",
      supportLevel: "L3",
      aliases: ["tsx", "javascript", "js", "jsx", "mjs", "cjs"],
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: true
    },
    {
      languageId: "python",
      supportLevel: "L3",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: true
    },
    {
      languageId: "go",
      supportLevel: "L3",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: true
    },
    {
      languageId: "rust",
      supportLevel: "L3",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: true
    },
    {
      languageId: "java",
      supportLevel: "L3",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: true
    },
    {
      languageId: "php",
      supportLevel: "L3",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: true
    },
    {
      languageId: "sql",
      supportLevel: "L3",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: true
    },
    {
      languageId: "markdown",
      supportLevel: "L2",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: false
    },
    {
      languageId: "c",
      supportLevel: "L2",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: false
    },
    {
      languageId: "cpp",
      supportLevel: "L2",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: false
    },
    {
      languageId: "c_sharp",
      supportLevel: "L2",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: false
    }
  ]
};
