import type { BoundaryKind } from "../contracts/boundaries/types.js";

export type SupportLevel = "L2" | "L3";

export type ParityQueryName = "imports" | "exports" | "symbols" | "skeleton";

export type ParityRequirement = {
  languageId: string;
  supportLevel: SupportLevel;
  aliases?: string[];
  requiredQueryPack: boolean;
  requiredWasmGrammar: boolean;
  requiredSyntaxValidator: boolean;
  requiredQueries?: ParityQueryName[];
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
      requiredSyntaxValidator: true,
      requiredQueries: ["imports", "exports", "symbols", "skeleton"]
    },
    {
      languageId: "python",
      supportLevel: "L3",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: true,
      requiredQueries: ["imports", "exports", "symbols", "skeleton"]
    },
    {
      languageId: "go",
      supportLevel: "L3",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: true,
      requiredQueries: ["imports", "exports", "symbols", "skeleton"]
    },
    {
      languageId: "rust",
      supportLevel: "L3",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: true,
      requiredQueries: ["imports", "exports", "symbols", "skeleton"]
    },
    {
      languageId: "java",
      supportLevel: "L3",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: true,
      requiredQueries: ["imports", "exports", "symbols", "skeleton"]
    },
    {
      languageId: "php",
      supportLevel: "L3",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: true,
      requiredQueries: ["imports", "exports", "symbols", "skeleton"]
    },
    {
      languageId: "sql",
      supportLevel: "L3",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: true,
      requiredQueries: ["symbols", "skeleton"]
    },
    {
      languageId: "markdown",
      supportLevel: "L2",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: false,
      requiredQueries: ["skeleton"]
    },
    {
      languageId: "c",
      supportLevel: "L2",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: false,
      requiredQueries: ["skeleton"]
    },
    {
      languageId: "cpp",
      supportLevel: "L2",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: false,
      requiredQueries: ["skeleton"]
    },
    {
      languageId: "c_sharp",
      supportLevel: "L2",
      requiredQueryPack: true,
      requiredWasmGrammar: true,
      requiredSyntaxValidator: false,
      requiredQueries: ["skeleton"]
    }
  ]
};

export const DEFAULT_REQUIRED_QUERIES: ParityQueryName[] = [
  "imports",
  "exports",
  "symbols",
  "skeleton"
];

export function resolveRequiredQueries(entry?: ParityRequirement): ParityQueryName[] {
  if (!entry?.requiredQueryPack) return [];
  const queries = entry.requiredQueries ?? DEFAULT_REQUIRED_QUERIES;
  return queries.length > 0 ? queries : DEFAULT_REQUIRED_QUERIES;
}
