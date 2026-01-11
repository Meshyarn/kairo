export type TokenBudgetOptions = {
  maxTokens?: number;
  maxChars?: number;
  charsPerToken?: number;
  elasticWindowPct?: number;
  languageId?: string;
  estimator?: "chars" | "whitespace";
};

export type TokenBudgetResult = {
  text: string;
  applied: boolean;
  mode: "none" | "truncate";
  maxTokens?: number;
  estimatedTokens?: number;
  maxChars?: number;
  usedChars: number;
  elasticWindowPct?: number;
};

const DEFAULT_CHARS_PER_TOKEN = 4;
const DEFAULT_ELASTIC_WINDOW_PCT = 0.05;

const LANGUAGE_MULTIPLIERS: Record<string, number> = {
  javascript: 1.05,
  typescript: 1.05,
  tsx: 1.05,
  jsx: 1.05,
  python: 1.05,
  java: 1.05,
  go: 1.05,
  rust: 1.1,
  cpp: 1.1,
  c: 1.1,
  csharp: 1.05,
  php: 1.05,
  json: 0.9,
  yaml: 0.9,
  markdown: 0.8
};

function normalizeLanguageId(raw?: string): string | undefined {
  if (!raw) return undefined;
  const value = raw.toLowerCase();
  if (value === "ts") return "typescript";
  if (value === "js") return "javascript";
  if (value === "c#") return "csharp";
  return value;
}

function estimateTokensByChars(text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
  const value = String(text ?? "");
  if (!value.length) return 0;
  const denom = charsPerToken > 0 ? charsPerToken : DEFAULT_CHARS_PER_TOKEN;
  return Math.ceil(value.length / denom);
}

function estimateTokensByWhitespace(text: string): number {
  const value = String(text ?? "");
  if (!value.length) return 0;
  const matches = value.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g);
  return matches ? matches.length : 0;
}

export function estimateTokens(
  text: string,
  options?: number | { charsPerToken?: number; estimator?: "chars" | "whitespace"; languageId?: string }
): number {
  const value = String(text ?? "");
  if (!value.length) return 0;
  const legacyChars = typeof options === "number" ? options : undefined;
  const estimator = typeof options === "object" && options?.estimator
    ? options.estimator
    : (process.env.KAIRO_TOKEN_ESTIMATOR === "chars" ? "chars" : "whitespace");
  const charsPerToken = typeof options === "object" ? options.charsPerToken : undefined;
  const base = estimator === "chars"
    ? estimateTokensByChars(value, legacyChars ?? charsPerToken ?? DEFAULT_CHARS_PER_TOKEN)
    : estimateTokensByWhitespace(value);
  const languageId = typeof options === "object" ? normalizeLanguageId(options.languageId) : undefined;
  const multiplier = languageId ? (LANGUAGE_MULTIPLIERS[languageId] ?? 1) : 1;
  return Math.max(1, Math.ceil(base * multiplier));
}

function findElasticCutIndex(text: string, targetChars: number, windowPct: number): number {
  const value = String(text ?? "");
  if (!value.length) return 0;
  const min = Math.max(1, Math.floor(targetChars * (1 - windowPct)));
  const max = Math.min(value.length, Math.ceil(targetChars * (1 + windowPct)));

  const findLastIndex = (patterns: string[]): number => {
    let best = -1;
    for (const pattern of patterns) {
      const index = value.lastIndexOf(pattern, max);
      if (index >= min && index > best) {
        best = index;
      }
    }
    return best;
  };

  const blockEnd = findLastIndex(["}\r\n", "}\n", "}\r"]);
  if (blockEnd >= 0) return blockEnd + 1;

  const paragraph = findLastIndex(["\r\n\r\n", "\n\n"]);
  if (paragraph >= 0) return paragraph + 2;

  const statement = findLastIndex([";\r\n", ";\n", ";", "\r\n", "\n"]);
  if (statement >= 0) return statement + 1;

  return Math.min(value.length, Math.max(1, targetChars));
}

export function applyTokenBudget(text: string, options: TokenBudgetOptions): TokenBudgetResult {
  const value = String(text ?? "");
  const maxTokens = Number.isFinite(options.maxTokens) && (options.maxTokens ?? 0) > 0
    ? options.maxTokens
    : undefined;
  const maxChars = Number.isFinite(options.maxChars) && (options.maxChars ?? 0) > 0
    ? options.maxChars
    : undefined;
  const charsPerToken = options.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  const estimator = options.estimator ?? (process.env.KAIRO_TOKEN_ESTIMATOR === "chars" ? "chars" : "whitespace");
  const windowPct = options.elasticWindowPct ?? DEFAULT_ELASTIC_WINDOW_PCT;
  const estimatedTokens = estimateTokens(value, {
    charsPerToken,
    estimator,
    languageId: options.languageId
  });

  if (!maxTokens && !maxChars) {
    return {
      text: value,
      applied: false,
      mode: "none",
      maxTokens,
      estimatedTokens,
      maxChars,
      usedChars: value.length,
      elasticWindowPct: maxTokens ? windowPct : undefined
    };
  }

  const tokenLimitChars = maxTokens ? Math.max(1, Math.floor(maxTokens * charsPerToken)) : Number.POSITIVE_INFINITY;
  const hardLimit = maxChars ?? Number.POSITIVE_INFINITY;
  const limit = Math.min(tokenLimitChars, hardLimit);

  if (value.length <= limit && (!maxTokens || estimatedTokens <= maxTokens)) {
    return {
      text: value,
      applied: false,
      mode: "none",
      maxTokens,
      estimatedTokens,
      maxChars,
      usedChars: value.length,
      elasticWindowPct: maxTokens ? windowPct : undefined
    };
  }

  let cutIndex = limit;
  if (maxTokens && tokenLimitChars <= hardLimit) {
    cutIndex = findElasticCutIndex(value, tokenLimitChars, windowPct);
  }

  const trimmed = value.slice(0, Math.max(1, cutIndex));
  const output = trimmed.length < value.length ? `${trimmed}…` : trimmed;

  return {
    text: output,
    applied: output.length < value.length,
    mode: output.length < value.length ? "truncate" : "none",
    maxTokens,
    estimatedTokens,
    maxChars,
    usedChars: output.length,
    elasticWindowPct: maxTokens ? windowPct : undefined
  };
}
