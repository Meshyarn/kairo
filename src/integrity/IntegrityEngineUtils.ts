import crypto from "crypto";
import type {
  IntegrityBlockPolicy,
  IntegrityLimits,
  IntegrityMode,
  IntegrityReport,
  IntegrityScope,
  IntegritySourceType,
  IntegrityClaim,
  IntegrityFinding
} from "./IntegrityTypes.js";
import { extractClaimsFromText } from "./ClaimExtractor.js";
import { extractClaimsFromCode } from "./CodeConstraintExtractor.js";

export type IntegrityDefaults = {
  maxFindings: number;
  maxChars: number;
  timeoutMs: number;
  minConfidence: number;
  minFindingsForAutoExpand: number;
  minClaimsForAutoExpand: number;
};

export function normalizeLimits(limits: IntegrityLimits | undefined, defaults: IntegrityDefaults): IntegrityLimits {
  return {
    maxFindings: normalizeNumber(limits?.maxFindings, defaults.maxFindings),
    maxChars: normalizeNumber(limits?.maxChars, defaults.maxChars),
    timeoutMs: normalizeNumber(limits?.timeoutMs, defaults.timeoutMs),
    minConfidence: normalizeNumber(limits?.minConfidence, defaults.minConfidence),
    minFindingsForAutoExpand: normalizeNumber(limits?.minFindingsForAutoExpand, defaults.minFindingsForAutoExpand),
    minClaimsForAutoExpand: normalizeNumber(limits?.minClaimsForAutoExpand, defaults.minClaimsForAutoExpand)
  };
}

export function normalizeMode(value: unknown, fallback?: IntegrityMode): IntegrityMode {
  if (value === "off" || value === "warn" || value === "preflight" || value === "strict") return value;
  if (fallback) return fallback;
  return "warn";
}

export function normalizeScope(value: unknown, fallback: IntegrityScope): IntegrityScope {
  if (value === "docs" || value === "project" || value === "auto") return value;
  return fallback;
}

export function normalizeBlockPolicy(value: unknown, fallback: IntegrityBlockPolicy): IntegrityBlockPolicy {
  if (value === "high_only" || value === "off") return value;
  return fallback;
}

export function normalizeSources(sources: IntegritySourceType[] | undefined, defaults: IntegritySourceType[]): IntegritySourceType[] {
  if (!Array.isArray(sources) || sources.length === 0) {
    return defaults;
  }
  const allowed = new Set(defaults.concat(["logs", "metrics"] as IntegritySourceType[]));
  const filtered = sources.filter((source) => allowed.has(source));
  return filtered.length > 0 ? filtered : defaults;
}

export function normalizeExtraSources(extraSources?: Array<"logs" | "metrics">): Array<"logs" | "metrics"> {
  if (!Array.isArray(extraSources)) return [];
  return extraSources.filter((source) => source === "logs" || source === "metrics");
}

export function normalizeNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

export function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function toFloat(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function extractClaimsFromSections(
  sections: any[],
  packId: string,
  sources: IntegritySourceType[],
  scope: IntegrityScope
): IntegrityClaim[] {
  const claims: IntegrityClaim[] = [];
  for (const section of sections) {
    const filePath = String(section?.filePath ?? "");
    if (!filePath) continue;
    const normalized = filePath.replace(/\\/g, "/");
    const isComment = section?.kind === "code_comment";
    const sourceType = isComment ? "comment" : classifySourceType(normalized);
    if (!sources.includes(sourceType)) continue;
    if (!isComment) {
      if (sourceType === "logs" || sourceType === "metrics") {
        // allow explicit extra sources
      } else if (!isDocPathForScope(normalized, scope)) {
        continue;
      }
    }
    const heading = section?.heading ?? section?.sectionPath?.join(" > ");
    const preview = section?.preview ?? "";
    const text = [heading, preview].filter(Boolean).join("\n");
    if (!text) continue;
    const evidenceRef = {
      packId,
      itemId: String(section?.id ?? section?.chunkId ?? `${filePath}:${section?.range?.startLine ?? 0}`),
      filePath,
      range: section?.range ? { startLine: section.range.startLine, endLine: section.range.endLine } : undefined
    };
    claims.push(
      ...extractClaimsFromText({
        text,
        filePath,
        sectionTitle: heading ?? undefined,
        sourceType,
        evidenceRef
      })
    );
  }
  return claims;
}

export function classifySourceType(filePath: string): IntegritySourceType {
  const normalized = filePath.replace(/\\/g, "/");
  if (isLogPath(normalized)) return "logs";
  if (isMetricsPath(normalized)) return "metrics";
  if (normalized.includes("/docs/adr/") || normalized.startsWith("docs/adr/")) return "adr";
  if (isReadmePath(normalized)) return "readme";
  return "docs";
}

export function isReadmePath(filePath: string): boolean {
  const base = filePath.split("/").pop() ?? "";
  return /^readme(\.|$)/i.test(base);
}

export function isDocPathForScope(filePath: string, scope: IntegrityScope): boolean {
  if (isReadmePath(filePath)) return true;
  if (!isMarkdownPath(filePath)) return false;
  if (scope === "docs") {
    return filePath.startsWith("docs/") || filePath.includes("/docs/");
  }
  return true;
}

export function isMarkdownPath(filePath: string): boolean {
  return /\.(md|mdx)$/i.test(filePath);
}

export function isLogPath(filePath: string): boolean {
  return /\.log$/i.test(filePath) || /\/logs?\//i.test(filePath);
}

export function isMetricsPath(filePath: string): boolean {
  if (/\.(csv|json)$/i.test(filePath)) {
    if (/(^|\/)metrics?\//i.test(filePath)) return true;
    if (/(^|\/)monitoring\//i.test(filePath)) return true;
  }
  const base = filePath.split("/").pop() ?? "";
  return /metrics?/i.test(base);
}

export function buildReport(
  findings: IntegrityFinding[],
  scopeUsed: IntegrityScope,
  options: { degradedReason?: string; maxFindings?: number }
): IntegrityReport {
  const bySeverity = { info: 0, warn: 0, high: 0 };
  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
  }
  const healthScore = computeHealthScore(findings);
  const topDomains = collectTopDomains(findings);
  const sorted = findings
    .slice()
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const topFindings = Number.isFinite(options.maxFindings) && (options.maxFindings ?? 0) > 0
    ? sorted.slice(0, options.maxFindings)
    : sorted;

  return {
    status: options.degradedReason ? "degraded" : "ok",
    scopeUsed,
    healthScore,
    summary: {
      totalFindings: findings.length,
      bySeverity,
      topDomains
    },
    topFindings,
    degradedReason: options.degradedReason
  };
}

export function buildDegradedReason(
  searchResponse: any,
  unsupportedSources: IntegritySourceType[],
  requestedScope: IntegrityScope | undefined,
  scopeUsed: IntegrityScope
): string | undefined {
  if (requestedScope === "project" && scopeUsed !== "project") return "scope_limited";
  if (unsupportedSources.length > 0) return "sources_not_supported";
  if (searchResponse?.degraded) return searchResponse?.reason ?? "search_degraded";
  return undefined;
}

export function computeHealthScore(findings: Array<{ severity: "info" | "warn" | "high"; confidence: number }>): number {
  const weights = { info: 0.1, warn: 0.3, high: 0.6 };
  const sum = findings.reduce((acc, finding) => acc + weights[finding.severity] * finding.confidence, 0);
  const score = 1 - Math.min(1, sum / 5);
  return Math.max(0, Math.min(1, score));
}

export function collectTopDomains(findings: Array<{ tags?: string[] }>): string[] | undefined {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    for (const tag of finding.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return undefined;
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag]) => tag);
}

export function computeIntegrityPackId(
  query: string,
  scope: IntegrityScope,
  sources: IntegritySourceType[],
  targetPaths?: string[]
): string {
  const normalized = stableStringify({
    query,
    scope,
    sources,
    targetPaths: targetPaths ?? []
  });
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export function stableStringify(value: any): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(v => stableStringify(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const parts = keys.map(k => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export async function extractClaimsFromCodeTargets(
  runTool: (tool: string, args: any) => Promise<any>,
  targetPaths: string[],
  packId: string
): Promise<IntegrityClaim[]> {
  const codeTargets = targetPaths.filter(isCodePath).slice(0, 3);
  if (codeTargets.length === 0) return [];
  const claims: IntegrityClaim[] = [];
  for (const target of codeTargets) {
    try {
      const content = await runTool("code_read", { filePath: target, view: "skeleton" });
      if (typeof content !== "string") continue;
      claims.push(
        ...extractClaimsFromCode({
          content,
          filePath: target,
          packId
        })
      );
    } catch {
      // ignore per-file errors
    }
  }
  return claims;
}

export function isCodePath(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|cpp|cc|c|h|hpp|cs|rb)$/i.test(filePath);
}

export function supportsExtraSource(source: IntegritySourceType): boolean {
  if (source === "logs") return true;
  if (source === "metrics") return true;
  return source === "adr" || source === "docs" || source === "readme" || source === "comment" || source === "code";
}
