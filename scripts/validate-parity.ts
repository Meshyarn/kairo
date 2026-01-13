import fs from "fs";
import path from "path";
import { BUILTIN_LANGUAGE_MAPPINGS } from "../src/config/LanguageConfig.js";
import { LANGUAGE_PARITY_MATRIX, resolveRequiredQueries } from "../src/config/LanguageParityMatrix.js";
import { AstManager } from "../src/ast/AstManager.js";

type Finding = {
  level: "error" | "warn";
  code: "MISSING_QUERY_PACK" | "MISSING_WASM_GRAMMAR" | "MISSING_VALIDATOR" | "LANGUAGE_SUPPORT_GAP";
  languageId: string;
  message: string;
};

const root = process.cwd();
const queriesRoot = path.join(root, "src", "queries");
const wasmCandidatesRoot = [
  path.join(root, "node_modules", "tree-sitter-wasms", "out"),
  path.join(root, "wasm")
];

const queryDirAliases: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  javascript: "typescript",
  js: "typescript",
  jsx: "typescript",
  md: "markdown",
  mdx: "markdown",
  py: "python",
  rs: "rust"
};

const mappedLanguageIds = new Set(
  Object.values(BUILTIN_LANGUAGE_MAPPINGS)
    .map((mapping) => mapping.languageId)
    .filter((id): id is string => typeof id === "string")
);

const languageIdToExtension = new Map<string, string>();
for (const [ext, mapping] of Object.entries(BUILTIN_LANGUAGE_MAPPINGS)) {
  if (!mapping?.languageId) continue;
  if (!languageIdToExtension.has(mapping.languageId)) {
    languageIdToExtension.set(mapping.languageId, ext);
  }
}

function resolveQueryDir(languageId: string): string {
  return queryDirAliases[languageId] ?? languageId;
}

function hasWasmAsset(languageId: string): boolean {
  const fileName = `tree-sitter-${languageId}.wasm`;
  return wasmCandidatesRoot.some((dir) => fs.existsSync(path.join(dir, fileName)));
}

async function collectFindings(): Promise<Finding[]> {
  const findings: Finding[] = [];
  const astManager = AstManager.getInstance();
  await astManager.init({ mode: "test", rootPath: root });
  for (const entry of LANGUAGE_PARITY_MATRIX.languages) {
    const level = entry.supportLevel === "L3" ? "error" : "warn";
    if (!mappedLanguageIds.has(entry.languageId)) {
      findings.push({
        level,
        code: "LANGUAGE_SUPPORT_GAP",
        languageId: entry.languageId,
        message: `No LanguageConfig mapping for "${entry.languageId}".`
      });
    }

    if (entry.requiredQueryPack) {
      const queryDir = resolveQueryDir(entry.languageId);
      const requiredQueries = resolveRequiredQueries(entry);
      for (const query of requiredQueries) {
        const filePath = path.join(queriesRoot, queryDir, `${query}.scm`);
        if (!fs.existsSync(filePath)) {
          findings.push({
            level,
            code: "MISSING_QUERY_PACK",
            languageId: entry.languageId,
            message: `${query}.scm not found`
          });
        }
      }
    }

    if (entry.requiredWasmGrammar && !hasWasmAsset(entry.languageId)) {
      findings.push({
        level,
        code: "MISSING_WASM_GRAMMAR",
        languageId: entry.languageId,
        message: `tree-sitter-${entry.languageId}.wasm not found`
      });
    }

    if (entry.requiredSyntaxValidator) {
      const ext = languageIdToExtension.get(entry.languageId);
      if (!ext) {
        findings.push({
          level,
          code: "MISSING_VALIDATOR",
          languageId: entry.languageId,
          message: "No LanguageConfig mapping available."
        });
      } else {
        const samplePath = path.join(root, `__kairo_parity__${ext}`);
        try {
          const language = await astManager.getLanguageForFile(samplePath);
          if (!language) {
            findings.push({
              level,
              code: "MISSING_VALIDATOR",
              languageId: entry.languageId,
              message: "Syntax validator unavailable for language."
            });
          }
        } catch {
          findings.push({
            level,
            code: "MISSING_VALIDATOR",
            languageId: entry.languageId,
            message: "Syntax validator unavailable for language."
          });
        }
      }
    }
  }
  return findings;
}

const findings = await collectFindings();
const useJson = process.argv.includes("--json");

if (useJson) {
  console.log(JSON.stringify({ findings }, null, 2));
} else {
  for (const finding of findings) {
    const label = finding.level.toUpperCase();
    console.log(`${label} [${finding.languageId}] ${finding.code}: ${finding.message}`);
  }
}

if (findings.some((finding) => finding.level === "error")) {
  process.exit(1);
}
