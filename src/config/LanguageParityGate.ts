import { AstManager } from "../ast/AstManager.js";
import { EngineManager } from "../orchestration/capabilities/EngineManager.js";
import { CAP_SYNTAX_VALIDATE } from "../orchestration/capabilities/CapabilityIds.js";
import {
  LANGUAGE_PARITY_MATRIX,
  type ParityQueryName,
  type ParityRequirement,
  resolveRequiredQueries
} from "./LanguageParityMatrix.js";

export type ParityOperation =
  | "read_skeleton"
  | "read_full"
  | "understand"
  | "explore_preview"
  | "change_plan"
  | "change_apply"
  | "write_plan"
  | "write_apply";

export type ParityGateResult = {
  outcome: "allow" | "degraded" | "block";
  reasons: string[];
  languageId?: string;
  missing?: string[];
};

export function resolveParityRequirement(languageId: string): ParityRequirement | undefined {
  const normalized = languageId.toLowerCase();
  for (const entry of LANGUAGE_PARITY_MATRIX.languages) {
    if (entry.languageId === normalized) return entry;
    if (entry.aliases?.includes(normalized)) return entry;
  }
  return undefined;
}

export function resolveOperationQueries(
  entry: ParityRequirement | undefined,
  operation: ParityOperation
): ParityQueryName[] {
  const requiredQueries = resolveRequiredQueries(entry);
  if (!entry?.requiredQueryPack || requiredQueries.length === 0) {
    return [];
  }

  switch (operation) {
    case "read_skeleton":
    case "understand":
    case "explore_preview":
      return requiredQueries.includes("skeleton") ? ["skeleton"] : [];
    case "read_full":
      return [];
    case "change_plan":
    case "change_apply":
    case "write_plan":
    case "write_apply":
    default:
      return requiredQueries;
  }
}

export async function evaluateLanguageParityGate(args: {
  filePath: string;
  operation: ParityOperation;
}): Promise<ParityGateResult> {
  if (process.env.KAIRO_SKIP_PARITY_CHECK === "true") {
    return { outcome: "allow", reasons: [] };
  }

  const astManager = AstManager.getInstance();
  const languageId = astManager.getLanguageId(args.filePath);
  const entry = resolveParityRequirement(languageId);
  const isApply = args.operation === "change_apply" || args.operation === "write_apply";
  const isChangePlan = args.operation === "change_plan";

  if (!entry) {
    return {
      outcome: "degraded",
      reasons: ["unsupported_language"],
      languageId
    };
  }

  const reasons: string[] = [];
  const missingQueries: string[] = [];
  let language: any | undefined;

  if (entry.requiredWasmGrammar || entry.requiredQueryPack) {
    try {
      language = await astManager.getLanguageForFile(args.filePath);
    } catch {
      language = undefined;
    }
  }

  if (entry.requiredWasmGrammar && !language) {
    reasons.push("missing_wasm_grammar");
  }

  const requiredQueries = resolveOperationQueries(entry, args.operation);
  if (entry.requiredQueryPack && requiredQueries.length > 0) {
    if (!language) {
      if (!reasons.includes("missing_wasm_grammar")) {
        reasons.push("missing_wasm_grammar");
      }
    } else {
      for (const queryName of requiredQueries) {
        const query = await astManager.getQueryProvider().getQuery(language, entry.languageId, queryName);
        if (!query) {
          missingQueries.push(queryName);
        }
      }
      if (missingQueries.length > 0) {
        reasons.push("missing_query_pack");
      }
    }
  }

  if (entry.requiredSyntaxValidator) {
    const provider = EngineManager.getProvider(CAP_SYNTAX_VALIDATE);
    if (!provider) {
      reasons.push("missing_syntax_validator");
    }
  }

  if (reasons.length === 0) {
    return { outcome: "allow", reasons: [], languageId };
  }

  return {
    outcome: entry.supportLevel === "L3" && (isApply || isChangePlan) ? "block" : "degraded",
    reasons,
    languageId,
    missing: missingQueries.length > 0 ? missingQueries : undefined
  };
}

export function formatParityBlockMessage(args: {
  filePath: string;
  result: ParityGateResult;
}): string {
  const reasons = args.result.reasons ?? [];
  if (reasons.includes("missing_wasm_grammar")) {
    return `Language parser unavailable for ${args.filePath}.`;
  }
  if (reasons.includes("missing_query_pack")) {
    const missingSummary = args.result.missing?.length ? ` (${args.result.missing.join(", ")})` : "";
    const languageId = args.result.languageId ?? "language";
    return `Missing query pack for ${languageId}${missingSummary}.`;
  }
  if (reasons.includes("missing_syntax_validator")) {
    return `Syntax validator unavailable for ${args.filePath}.`;
  }
  if (reasons.includes("unsupported_language")) {
    return `Language is not supported for ${args.filePath}.`;
  }
  return "Language parity requirements are missing.";
}
