import type { IntegrityFinding, IntegrityReport } from '../../../integrity/IntegrityTypes.js';

export function shouldBlockIntegrity(
  mode: string,
  blockPolicy: string | undefined,
  report: IntegrityReport
): boolean {
  if (!report?.summary) return false;
  if (blockPolicy === "off") return false;
  const highCount = report.summary.bySeverity?.high ?? 0;
  const warnCount = report.summary.bySeverity?.warn ?? 0;
  if (mode === "strict") {
    return highCount + warnCount > 0;
  }
  return highCount > 0;
}

export function formatIntegrityBlockMessage(findings?: IntegrityFinding[]): string {
  const items = Array.isArray(findings) ? findings.slice(0, 3) : [];
  if (items.length === 0) {
    return "Integrity check blocked. Resolve conflicts before applying.";
  }
  const summary = items
    .map((finding, index) => `${index + 1}) ${summarizeIntegrityFinding(finding)}`)
    .join("; ");
  return `Integrity check blocked. Fix first: ${summary}`;
}

export function summarizeIntegrityFinding(finding: IntegrityFinding): string {
  const left = compactIntegrityText(finding.claimA ?? "");
  const right = compactIntegrityText(finding.claimB ?? "");
  return right ? `${left} vs ${right}` : left;
}

export function compactIntegrityText(text: string, max = 80): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}
