
import type {
  GuidanceMetaV1,
  GuidanceV1,
  RecoveryStrategyV1,
  SuggestedActionV1,
  WarningV1
} from "../types/guidance.js";

/**
 * GuidanceGenerator: Applies heuristic rules to guide the agent's next steps.
 */
export class GuidanceGenerator {
  public generate(context: {
    lastPillar: string;
    lastResult: any;
    insights: any[];
    error?: any;
    history?: Array<{ tool: string; args?: any; output?: any; status?: string }>;
    synthesis?: { hotSpots?: any[]; pageRankCoverage?: number; impactIncluded?: boolean };
  }): GuidanceV1 {
    const suggestedActions: SuggestedActionV1[] = [];
    const warnings: WarningV1[] = [];
    let message = 'Operation completed successfully.';
    const history = context.history ?? [];
    const hasTestContext = this.detectTestContext(history);

    if (context.lastResult?.success === false) {
      message = context.lastResult?.message
        ? `Operation failed: ${context.lastResult.message}`
        : 'Operation failed.';

      warnings.push({
        severity: 'warning',
        code: context.lastResult?.status ?? 'FAILED',
        message: context.lastResult?.message ?? 'The operation did not succeed.'
      });

      if (context.lastPillar === 'explore' && context.lastResult?.status === 'invalid_args') {
        suggestedActions.push({
          id: 'explore.retry',
          priority: 1,
          description: 'Retry explore with a query or explicit paths.',
          rationale: 'The explore tool requires at least one of query or paths.',
          toolCall: {
            tool: 'explore',
            args: { query: 'package.json', view: 'preview' }
          }
        });
      }
    }

    // Rule 1: Post-Understand -> Examine primary file
    if (context.lastPillar === 'understand' && context.lastResult.primaryFile) {
      message = `Codebase structure for "${context.lastResult.summary}" has been analyzed.`;
      suggestedActions.push({
        id: 'explore.examine.primary',
        priority: 1,
        description: `Deep dive into "${context.lastResult.primaryFile}"`,
        rationale: 'Reviewing the actual implementation is the best next step before making changes.',
        toolCall: {
          tool: 'explore',
          args: { paths: [context.lastResult.primaryFile], view: 'preview' }
        }
      });
    }

    // Rule 1c: Missing tests after understanding core area
    if (context.lastPillar === 'understand' && !hasTestContext) {
      const target = context.lastResult.primaryFile ?? context.lastResult.target ?? context.lastResult.filePath;
      if (target) {
        suggestedActions.push({
          id: 'explore.find_tests',
          priority: 2,
          description: 'Locate related tests for the analyzed module.',
          rationale: 'Reviewing tests reduces regression risk before changes.',
          toolCall: {
            tool: 'explore',
            args: { query: `${target} test` }
          }
        });
      }
    }

    // Rule 1b: No results -> broaden explore
    if ((context.lastResult?.results?.length === 0 || context.lastResult?.locations?.length === 0)) {
      suggestedActions.push({
        id: 'explore.retry.broaden',
        priority: 1,
        description: 'No results found. Broaden the search scope.',
        rationale: 'A wider search improves discovery when exact matches fail.',
        toolCall: {
          tool: 'explore',
          args: { query: context.lastResult?.target ?? context.lastResult?.query ?? 'all' }
        }
      });
    }

    // Rule 2: Post-Change (DryRun) -> Apply
    const dryRunStep = history.find(step => step.tool === 'edit_transaction' && step.args?.dryRun === true);
    if (context.lastPillar === 'change' && (context.lastResult.operation === 'plan' || dryRunStep)) {
      message = 'Change plan generated and verified via DryRun.';
      const impactRisk = this.extractImpactRisk(context);
      if (!impactRisk || impactRisk.level !== 'high') {
        suggestedActions.push({
          id: 'change.apply',
          priority: 1,
          description: 'Apply these changes to the codebase.',
          rationale: 'The changes have been verified and impact is identified.',
          toolCall: {
            tool: 'change',
            args: { intent: context.lastResult.intent ?? 'Apply planned changes', options: { dryRun: false } }
          }
        });
      } else {
        suggestedActions.push({
          id: 'explore.verify.risk',
          priority: 1,
          description: 'High risk detected. Review impacted files before applying.',
          rationale: 'Impact analysis suggests elevated risk.',
          toolCall: {
            tool: 'explore',
            args: { paths: [impactRisk.primaryTarget], view: 'preview' }
          }
        });
      }
    }

    // Rule 2b: Post-Change Success -> verify + tests
    const applyStep = history.find(step => step.tool === 'edit_transaction' && step.args?.dryRun === false);
    if (context.lastPillar === 'change' && (context.lastResult.operation === 'apply' || applyStep)) {
      const target = context.lastResult.targetFile ?? context.lastResult.filePath;
      if (target) {
        suggestedActions.push({
          id: 'explore.verify.file',
          priority: 1,
          description: 'Verify the updated file content.',
          rationale: 'Confirm the change was applied as intended.',
          toolCall: { tool: 'explore', args: { paths: [target], view: 'preview' } }
        });
        suggestedActions.push({
          id: 'manage.test.target',
          priority: 2,
          description: 'Run suggested tests for impacted areas.',
          rationale: 'Validate behavior in impacted regions.',
          toolCall: { tool: 'manage', args: { command: 'test', target } }
        });
      }
    }

    // Rule 3: Error Recovery
    if (context.error) {
      message = `Operation failed: ${context.error.message}`;
      suggestedActions.push({
        id: 'manage.status',
        priority: 1,
        description: 'Check project index status.',
        rationale: 'Failures are often caused by stale indices.',
        toolCall: { tool: 'manage', args: { command: 'status' } }
      });
      warnings.push({
        severity: 'warning',
        code: context.error.code ?? 'UNKNOWN_ERROR',
        message: context.error.message ?? 'An error occurred.',
        affectedTargets: context.error.target ? [context.error.target] : undefined
      });
    }

    const integrityReport = context.lastResult?.integrity;
    const integrityFindings = Array.isArray(integrityReport?.topFindings)
      ? integrityReport.topFindings.slice(0, 3)
      : [];
    if (integrityFindings.length > 0) {
      for (const finding of integrityFindings) {
        warnings.push({
          severity: this.mapIntegritySeverity(finding.severity),
          code: "INTEGRITY_CONFLICT",
          message: `Integrity conflict: ${this.summarizeIntegrityFinding(finding)}`,
          affectedTargets: this.collectIntegrityTargets(finding)
        });
      }
      if (!context.error && (context.lastResult?.status === "blocked" || integrityReport?.status === "blocked")) {
        const summary = integrityFindings
          .map((finding: any, index: number) => `${index + 1}) ${this.summarizeIntegrityFinding(finding)}`)
          .join("; ");
        message = `Integrity check blocked. Fix first: ${summary}`;
      }
    }

    // Rule 4: High Risk Warning Integration
    const highRisk = context.insights.find(i => i.severity === 'high');
    if (highRisk) {
      warnings.push({
        severity: 'critical',
        code: 'HIGH_RISK',
        message: highRisk.observation,
        affectedTargets: highRisk.affectedFiles
      });
      message = 'High architectural risk detected. Proceed with caution.';
    }

    // Rule 5: HotSpot warning
    if ((context.synthesis?.hotSpots?.length ?? 0) > 0) {
      warnings.push({
        severity: 'warning',
        code: 'HOTSPOT_AFFECTED',
        message: `${context.synthesis?.hotSpots?.length} hotspot areas detected.`,
        affectedTargets: context.synthesis?.hotSpots?.map((hs: any) => hs.filePath).filter(Boolean)
      });
    }

    // Rule 6: High impact risk follow-up
    const impactRisk = this.extractImpactRisk(context);
    if (impactRisk) {
      warnings.push({
        severity: impactRisk.level === 'high' ? 'critical' : 'warning',
        code: 'IMPACT_RISK',
        message: `Impact analysis indicates ${impactRisk.level} risk.`,
        affectedTargets: impactRisk.affectedFiles
      });
      suggestedActions.push({
        id: 'manage.test.impact',
        priority: 1,
        description: 'Run suggested tests for impacted areas.',
        rationale: 'Impact analysis detected elevated risk.',
        toolCall: {
          tool: 'manage',
          args: { command: 'test', target: impactRisk.primaryTarget }
        }
      });
    }

    // Rule 7: Dependency risk follow-up
    const dependencyInsight = context.insights.find(i => i.type === 'dependency');
    if (dependencyInsight) {
      suggestedActions.push({
        id: 'understand.analyze.dependencies',
        priority: 2,
        description: 'Analyze dependency structure for cyclic risks.',
        rationale: 'Dependency insight suggests structural risks.',
        toolCall: {
          tool: 'understand',
          args: { goal: 'Analyze dependency cycles', scope: 'module', depth: 'deep' }
        }
      });
    }

    const degradedReasons = this.extractDegradedReasons(context.lastResult);
    const actionScopes = this.extractManageDoctorScopes(context.lastResult);
    for (const scope of actionScopes) {
      this.appendManageDoctorSuggestion(suggestedActions, scope);
    }
    if (this.hasContractDegradedReason(degradedReasons)) {
      this.appendManageDoctorSuggestion(suggestedActions, 'contracts');
    }
    if (this.hasLanguageSupportDegradedReason(degradedReasons)) {
      this.appendManageDoctorSuggestion(suggestedActions, 'languages');
    }
    if (this.hasParityDegradedReason(degradedReasons)) {
      this.appendManageDoctorSuggestion(suggestedActions, 'parity');
    }

    const recoveryStrategies = context.error ? this.buildRecoveryStrategies(context.error) : undefined;
    const meta: GuidanceMetaV1 = {
      generatedAt: new Date().toISOString(),
      basedOn: {
        hotSpotCount: context.synthesis?.hotSpots?.length ?? 0,
        pageRankCoverage: context.synthesis?.pageRankCoverage ?? 0,
        impactAnalysisIncluded: Boolean(context.synthesis?.impactIncluded)
      },
      confidence: this.calculateConfidence(context)
    };

    return {
      message,
      contextSummary: `Context: ${context.lastPillar}`,
      suggestedActions: suggestedActions.sort((a, b) => a.priority - b.priority).slice(0, 3),
      warnings,
      recoveryStrategies,
      meta
    };
  }

  private buildRecoveryStrategies(error: any): RecoveryStrategyV1[] {
    const strategies: RecoveryStrategyV1[] = [];
    const code = error?.code ?? '';

    if (code === 'NO_MATCH' || /no match/i.test(error?.message ?? '')) {
      strategies.push({
        name: 'Refresh Context',
        description: 'Inspect the exact target block before retrying.',
        toolCall: {
          tool: 'explore',
          args: { paths: [error.target], view: 'section' }
        }
      });
    }
    if (code === 'HASH_MISMATCH' || /hash mismatch/i.test(error?.message ?? '')) {
      strategies.push({
        name: 'Reload File',
        description: 'Reload the file to sync with latest content.',
        toolCall: { tool: 'explore', args: { paths: [error.target], view: 'full' } }
      });
    }
    if (code === 'INDEX_STALE') {
      strategies.push({
        name: 'Rebuild Index',
        description: 'Rebuild indices before retrying.',
        toolCall: { tool: 'manage', args: { command: 'rebuild' } }
      });
    }

    return strategies;
  }

  private calculateConfidence(context: { insights: any[]; error?: any }): number {
    if (context.error) return 0.5;
    if (context.insights.length === 0) return 0.6;
    return 0.8;
  }

  private extractDegradedReasons(lastResult: any): string[] {
    const reasons: string[] = [];
    if (Array.isArray(lastResult?.reasons)) {
      reasons.push(...lastResult.reasons);
    }
    if (Array.isArray(lastResult?.degradedReasons)) {
      for (const entry of lastResult.degradedReasons) {
        if (typeof entry === "string") {
          reasons.push(entry);
          continue;
        }
        if (entry && typeof entry.type === "string") {
          reasons.push(entry.type);
        }
      }
    }
    return reasons.filter((reason) => typeof reason === "string");
  }

  private hasContractDegradedReason(reasons: string[]): boolean {
    return reasons.some((reason) => reason.startsWith("contract_") || reason.startsWith("cross_lang_contract_"));
  }

  private hasLanguageSupportDegradedReason(reasons: string[]): boolean {
    return reasons.some((reason) => reason === "unsupported_language");
  }

  private hasParityDegradedReason(reasons: string[]): boolean {
    return reasons.some((reason) => reason === "missing_query_pack" || reason === "missing_wasm_grammar");
  }

  private extractManageDoctorScopes(lastResult: any): string[] {
    const scopes = new Set<string>();
    if (Array.isArray(lastResult?.degradedReasons)) {
      for (const entry of lastResult.degradedReasons) {
        if (!entry || typeof entry !== "object") continue;
        const toolCall = entry.actionToolCall;
        if (toolCall && toolCall.tool === "manage" && toolCall.args) {
          const args = toolCall.args as { command?: unknown; scope?: unknown };
          if (args.command === "doctor" && typeof args.scope === "string") {
            scopes.add(args.scope);
          }
        }
      }
    }
    return Array.from(scopes);
  }

  private appendManageDoctorSuggestion(suggestedActions: SuggestedActionV1[], scope: string): void {
    const actionId = `manage.doctor.${scope}`;
    const alreadySuggested = suggestedActions.some((action) => action.id === actionId);
    if (alreadySuggested) return;
    const description = scope === "contracts"
      ? "Verify contract manifests for cross-language boundaries."
      : (scope === "parity"
        ? "Verify parity assets (query packs/grammars/validators)."
        : "Verify language asset mappings and support.");
    const rationale = scope === "contracts"
      ? "Contract evidence is missing or degraded; doctor can show setup gaps."
      : (scope === "parity"
        ? "Parity assets appear missing or degraded."
        : "Language support assets appear missing or degraded.");
    suggestedActions.push({
      id: actionId,
      priority: 2,
      description,
      rationale,
      toolCall: { tool: 'manage', args: { command: 'doctor', scope } }
    });
  }

  private detectTestContext(history: Array<{ tool: string; args?: any; output?: any }>): boolean {
    const patterns = [/\.test\./i, /__tests__/i, /\/tests?\//i];
    const hitsPath = (value: string | undefined) => {
      if (!value) return false;
      return patterns.some(pattern => pattern.test(value));
    };

    for (const step of history) {
      if (hitsPath(step.args?.filePath) || hitsPath(step.args?.target)) {
        return true;
      }
      if (hitsPath(step.output?.filePath) || hitsPath(step.output?.path)) {
        return true;
      }
      if (Array.isArray(step.output?.results)) {
        if (step.output.results.some((r: any) => hitsPath(r?.path))) {
          return true;
        }
      }
    }
    return false;
  }

  private extractImpactRisk(context: {
    insights: any[];
    lastResult: any;
  }): { level: 'high' | 'medium'; affectedFiles: string[]; primaryTarget?: string } | null {
    const impactInsight = context.insights.find(i => i.type === 'risk' && /impact/i.test(i.observation));
    if (!impactInsight) return null;
    const level = impactInsight.severity === 'high' ? 'high' : 'medium';
    const affectedFiles = Array.isArray(impactInsight.affectedFiles) ? impactInsight.affectedFiles : [];
    const primaryTarget = context.lastResult?.targetFile ?? context.lastResult?.filePath ?? affectedFiles[0];
    return { level, affectedFiles, primaryTarget };
  }

  private mapIntegritySeverity(severity: "info" | "warn" | "high"): "info" | "warning" | "critical" {
    if (severity === "high") return "critical";
    if (severity === "warn") return "warning";
    return "info";
  }

  private summarizeIntegrityFinding(finding: { claimA?: string; claimB?: string }): string {
    const left = this.compactText(String(finding.claimA ?? ""));
    const right = this.compactText(String(finding.claimB ?? ""));
    return right ? `${left} vs ${right}` : left;
  }

  private compactText(value: string, max = 80): string {
    const trimmed = value.replace(/\s+/g, " ").trim();
    if (trimmed.length <= max) return trimmed;
    return `${trimmed.slice(0, max - 3)}...`;
  }

  private collectIntegrityTargets(finding: { evidenceRefs?: Array<{ filePath?: string | null }> }): string[] | undefined {
    const targets = (finding.evidenceRefs ?? [])
      .map(ref => ref?.filePath ?? "")
      .filter(Boolean);
    const unique = Array.from(new Set(targets));
    return unique.length > 0 ? unique.slice(0, 3) : undefined;
  }
}
