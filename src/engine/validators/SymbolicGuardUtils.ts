const FUNCTION_NODE_TYPES = new Set([
  "function_declaration",
  "function_expression",
  "arrow_function",
  "method_definition",
  "generator_function",
  "generator_function_declaration",
  "class_method",
  "method"
]);

const normalizeText = (value: string): string => value.replace(/\s+/g, "").toLowerCase();

export const isSimpleIdentifier = (value: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);

export const isLiteralZero = (value: string): boolean => /^[-+]?0+(?:\.0+)?n?$/.test(value.trim());

export const isNullLiteral = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return normalized === "null" || normalized === "undefined";
};

export const hasNullGuard = (identifier: string, guardTexts: string[]): boolean => {
  const needle = normalizeText(identifier);
  return guardTexts.some((raw) => {
    const text = normalizeText(raw);
    if (!text.includes(needle)) return false;
    return text.includes("!=null")
      || text.includes("!==null")
      || text.includes("!=undefined")
      || text.includes("!==undefined");
  });
};

export const hasIndexGuard = (indexExpr: string, guardTexts: string[]): boolean => {
  const needle = normalizeText(indexExpr);
  if (!needle) return false;
  return guardTexts.some((raw) => {
    const text = normalizeText(raw);
    if (!text.includes(needle)) return false;
    const hasLength = text.includes(".length") || text.includes("len(") || text.includes("size(") || text.includes("count(");
    const hasComparator = text.includes("<") || text.includes(">");
    return hasLength && hasComparator;
  });
};

export const hasZeroGuard = (denomExpr: string, guardTexts: string[]): boolean => {
  const needle = normalizeText(denomExpr);
  if (!needle) return false;
  return guardTexts.some((raw) => {
    const text = normalizeText(raw);
    if (!text.includes(needle)) return false;
    return text.includes("!=0")
      || text.includes("!==0")
      || text.includes(">0")
      || text.includes(">=1");
  });
};

const findFunctionScope = (node: any): any => {
  let current = node;
  while (current) {
    if (FUNCTION_NODE_TYPES.has(current.type)) {
      return current;
    }
    current = current.parent;
  }
  return null;
};

export const scopeKeyForNode = (node: any): string => {
  const scope = findFunctionScope(node);
  if (!scope) return "global";
  return `${scope.startIndex}:${scope.endIndex}`;
};

export const extractNodeText = (node: any, content: string): string => {
  if (!node) return "";
  return content.slice(node.startIndex, node.endIndex);
};

export const resolveIndexNode = (node: any): any => {
  if (!node) return null;
  const direct = node.childForFieldName?.("index");
  if (direct) return direct;
  if (typeof node.namedChildCount === "number" && typeof node.namedChild === "function" && node.namedChildCount > 0) {
    return node.namedChild(node.namedChildCount - 1);
  }
  if (Array.isArray(node.namedChildren) && node.namedChildren.length > 0) {
    return node.namedChildren[node.namedChildren.length - 1];
  }
  return null;
};

export const extractIndexFromSubscript = (text: string): string => {
  const match = text.match(/\[([^\]]+)\]/);
  return match ? match[1].trim() : "";
};

export const positionFromIndex = (content: string, index: number): { line: number; column: number } => {
  if (index <= 0) return { line: 1, column: 1 };
  let line = 1;
  let lastLineStart = 0;
  for (let i = 0; i < content.length && i < index; i += 1) {
    if (content[i] === "\n") {
      line += 1;
      lastLineStart = i + 1;
    }
  }
  return { line, column: index - lastLineStart + 1 };
};

export const extractIndexFallbacks = (
  content: string,
  limit: number
): Array<{ indexText: string; snippet: string; startIndex: number }> => {
  const results: Array<{ indexText: string; snippet: string; startIndex: number }> = [];
  const pattern = /([A-Za-z_$][\w$]*)\s*\[\s*([A-Za-z_$][\w$]*)\s*\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const indexText = match[2];
    if (!indexText) continue;
    results.push({
      indexText,
      snippet: match[0].slice(0, 160),
      startIndex: match.index
    });
    if (results.length >= limit) break;
  }
  return results;
};
