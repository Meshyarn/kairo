import type {
  IntegrityOptions,
  IntegrityReport,
  IntegrityResult,
  IntegrityScope,
  IntegritySourceType,
  IntegrityRequest,
  IntegrityClaim,
  IntegrityFinding
} from "./IntegrityTypes.js";
import { detectNumericConflicts } from "./ConflictDetector.js";
import { shouldAutoExpandScope } from "./ScopeResolver.js";
import {
  buildDegradedReason,
  buildReport,
  computeIntegrityPackId,
  extractClaimsFromCodeTargets,
  extractClaimsFromSections,
  normalizeBlockPolicy,
  normalizeExtraSources,
  normalizeLimits,
  normalizeMode,
  normalizeScope,
  normalizeSources,
  isCodePath,
  supportsExtraSource,
  toFloat,
  toInt
} from "./IntegrityEngineUtils.js";

export type IntegrityPillar = "explore" | "understand" | "change";
export type IntegrityToolRunner = (tool: string, args: any) => Promise<any>;

const DEFAULT_SOURCES: IntegritySourceType[] = ["adr", "docs", "readme", "comment", "code"];
const DEFAULT_MAX_FINDINGS = toInt(process.env.KAIRO_INTEGRITY_MAX_FINDINGS, 6);
const DEFAULT_MAX_CHARS = toInt(process.env.KAIRO_INTEGRITY_MAX_CHARS, 1600);
const DEFAULT_MIN_CONFIDENCE = toFloat(process.env.KAIRO_INTEGRITY_MIN_CONFIDENCE, 0.65);
const DEFAULT_TIMEOUT_MS = toInt(process.env.KAIRO_INTEGRITY_TIMEOUT_MS, 1500);
const DEFAULT_MIN_FINDINGS = toInt(process.env.KAIRO_INTEGRITY_AUTO_MIN_FINDINGS, 2);
const DEFAULT_MIN_CLAIMS = toInt(process.env.KAIRO_INTEGRITY_AUTO_MIN_CLAIMS, 4);

const DEFAULT_SCOPE = normalizeScope(process.env.KAIRO_INTEGRITY_SCOPE, "auto");
const DEFAULT_BLOCK_POLICY = normalizeBlockPolicy(
  process.env.KAIRO_INTEGRITY_BLOCK_POLICY,
  "high_only"
);

export class IntegrityEngine {
  public static resolveOptions(input: unknown, pillar: IntegrityPillar): IntegrityOptions | undefined {
    if (input === undefined || input === null || input === false) return undefined;
    const raw = input === true ? {} : input;
    if (typeof raw !== "object") return undefined;

    const envMode = normalizeMode(process.env.KAIRO_INTEGRITY_MODE, undefined);
    const pillarDefault = pillar === "change" ? "preflight" : "warn";
    const mode = normalizeMode((raw as IntegrityOptions).mode, envMode ?? pillarDefault);
    const scope = normalizeScope((raw as IntegrityOptions).scope, DEFAULT_SCOPE);
    const sources = normalizeSources((raw as IntegrityOptions).sources, DEFAULT_SOURCES);
    const extraSources = normalizeExtraSources((raw as IntegrityOptions).extraSources);
    const combinedSources = normalizeSources([...sources, ...extraSources], DEFAULT_SOURCES);
    const blockPolicy =
      pillar === "change"
        ? normalizeBlockPolicy((raw as IntegrityOptions).blockPolicy, DEFAULT_BLOCK_POLICY)
        : DEFAULT_BLOCK_POLICY;

    const limits = normalizeLimits((raw as IntegrityOptions).limits, {
      maxFindings: DEFAULT_MAX_FINDINGS,
      maxChars: DEFAULT_MAX_CHARS,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      minConfidence: DEFAULT_MIN_CONFIDENCE,
      minFindingsForAutoExpand: DEFAULT_MIN_FINDINGS,
      minClaimsForAutoExpand: DEFAULT_MIN_CLAIMS
    });

    return {
      mode,
      scope,
      sources: combinedSources,
      extraSources,
      blockPolicy,
      limits
    };
  }

  public static buildPlaceholderReport(options: IntegrityOptions): IntegrityResult {
    const report: IntegrityReport = {
      status: "degraded",
      scopeUsed: options.scope ?? "auto",
      healthScore: 1,
      summary: {
        totalFindings: 0,
        bySeverity: { info: 0, warn: 0, high: 0 },
        topDomains: []
      },
      topFindings: [],
      degradedReason: "integrity_not_implemented"
    };

    return { report };
  }

  public static async run(
    request: IntegrityRequest,
    runTool: IntegrityToolRunner
  ): Promise<IntegrityResult> {
    const query = String(request.query ?? "").trim();
    if (!query) {
      return {
        report: {
          status: "degraded",
          scopeUsed: "docs",
          healthScore: 1,
          summary: {
            totalFindings: 0,
            bySeverity: { info: 0, warn: 0, high: 0 }
          },
          topFindings: [],
          degradedReason: "missing_query"
        }
      };
    }

    const limits = normalizeLimits(request.limits, {
      maxFindings: DEFAULT_MAX_FINDINGS,
      maxChars: DEFAULT_MAX_CHARS,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      minConfidence: DEFAULT_MIN_CONFIDENCE,
      minFindingsForAutoExpand: DEFAULT_MIN_FINDINGS,
      minClaimsForAutoExpand: DEFAULT_MIN_CLAIMS
    });
    const requestedScope = normalizeScope(request.scope, "docs");
    const sources = Array.isArray(request.sources) && request.sources.length > 0
      ? request.sources
      : DEFAULT_SOURCES;
    const docSources = sources.filter(source => (
      source === "adr" || source === "docs" || source === "readme" || source === "logs" || source === "metrics"
    ));
    const includeComments = sources.includes("comment");
    const includeCode = sources.includes("code");
    const includeLogs = sources.includes("logs");
    const includeMetrics = sources.includes("metrics");
    const unsupported = sources.filter(source => !supportsExtraSource(source));
    const noteMissingCodeTargets =
      includeCode && (request.targetPaths ?? []).filter(isCodePath).length === 0;

    const scopesToTry: IntegrityScope[] = requestedScope === "auto" ? ["docs", "project"] : [requestedScope];
    let scopeUsed: IntegrityScope = scopesToTry[0] ?? "docs";
    let searchResponse: any;
    let packId = "";
    let claims: IntegrityClaim[] = [];
    let findings: IntegrityFinding[] = [];
    let expanded = false;
    let expansionReason: string | undefined;

    for (const scopeCandidate of scopesToTry) {
      try {
        searchResponse = await runTool("document_search", {
          query,
          output: "compact",
          includeEvidence: true,
          maxResults: Math.max(6, limits.maxFindings ?? DEFAULT_MAX_FINDINGS),
          includeComments,
          scope: scopeCandidate === "project" ? "project" : "docs",
          includeLogs,
          includeMetrics
        });
      } catch (error) {
        return {
          report: {
            status: "degraded",
            scopeUsed: "docs",
            healthScore: 1,
            summary: {
              totalFindings: 0,
              bySeverity: { info: 0, warn: 0, high: 0 }
            },
            topFindings: [],
            degradedReason: "doc_search_failed"
          }
        };
      }

      packId = searchResponse?.pack?.packId ?? computeIntegrityPackId(query, scopeCandidate, docSources, request.targetPaths);
      const sections = Array.isArray(searchResponse?.evidence) && searchResponse.evidence.length > 0
        ? searchResponse.evidence
        : (searchResponse?.results ?? []);
      claims = extractClaimsFromSections(sections, packId, sources, scopeCandidate);
      const docFindings = detectNumericConflicts(claims);

      if (requestedScope !== "auto") {
        scopeUsed = scopeCandidate;
        break;
      }

      const docClaims = claims.filter(claim => claim.sourceType === "adr" || claim.sourceType === "docs" || claim.sourceType === "readme");
      const expansionDecision = scopeCandidate === "docs"
        ? shouldAutoExpandScope({
            query,
            docClaimsCount: docClaims.length,
            findings: docFindings,
            limits,
            defaults: {
              minClaims: DEFAULT_MIN_CLAIMS,
              minFindings: DEFAULT_MIN_FINDINGS,
              minConfidence: DEFAULT_MIN_CONFIDENCE
            }
          })
        : { expand: false };
      if (expansionDecision.expand) {
        expanded = true;
        expansionReason = expansionDecision.reason;
        continue;
      } else {
        scopeUsed = scopeCandidate;
        break;
      }
    }

    const codeClaims = includeCode
      ? await extractClaimsFromCodeTargets(runTool, request.targetPaths ?? [], packId)
      : [];
    findings = detectNumericConflicts([...claims, ...codeClaims]);

    const degradedReason = buildDegradedReason(searchResponse, unsupported, requestedScope, scopeUsed)
      ?? (noteMissingCodeTargets ? "missing_code_targets" : undefined)
      ?? ((claims.length + codeClaims.length) === 0 ? "no_claims" : undefined);

    const report = buildReport(findings, scopeUsed, {
      degradedReason,
      maxFindings: limits.maxFindings ?? DEFAULT_MAX_FINDINGS
    });

    report.packId = packId;
    if (requestedScope === "auto") {
      report.scopeExpansion = {
        requested: requestedScope,
        used: scopeUsed,
        expanded,
        reason: expanded ? expansionReason : undefined
      };
    } else {
      report.scopeExpansion = {
        requested: requestedScope,
        used: scopeUsed,
        expanded: false
      };
    }
    if (searchResponse?.degraded && searchResponse?.reason) {
      report.degradedReason = report.degradedReason ?? searchResponse.reason;
    }

    return {
      report
    };
    }
}
