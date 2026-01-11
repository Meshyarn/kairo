export type TokenBudgetOptions = {
  maxTokens?: number;
  maxChars?: number;
  charsPerToken?: number;
  elasticWindowPct?: number;
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

export function estimateTokens(text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
  const value = String(text ?? "");
  if (!value.length) return 0;
  const denom = charsPerToken > 0 ? charsPerToken : DEFAULT_CHARS_PER_TOKEN;
  return Math.ceil(value.length / denom);
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
  const windowPct = options.elasticWindowPct ?? DEFAULT_ELASTIC_WINDOW_PCT;
  const estimatedTokens = estimateTokens(value, charsPerToken);

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
