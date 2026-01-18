import { metrics } from "../../../utils/MetricsCollector.js";

export function evaluateIntegrityGuardrailBlock(args: {
  guardrailResult: any;
  dryRun: boolean;
  bypass: boolean;
  workflowWarnings?: string[];
  warningMessage?: string;
  downgradeOnBypass?: boolean;
}): { blocked: boolean; bypassed: boolean; guardrailResult: any } {
  const stopTimer = metrics.startTimer("decision.integrity_guardrail_ms", "detailed");
  try {
  if (args.dryRun) {
    return { blocked: false, bypassed: false, guardrailResult: args.guardrailResult };
  }
  if (!args.guardrailResult || args.guardrailResult.status !== "block") {
    return { blocked: false, bypassed: false, guardrailResult: args.guardrailResult };
  }
  if (args.bypass) {
    if (args.workflowWarnings && args.warningMessage) {
      args.workflowWarnings.push(args.warningMessage);
    }
    const guardrailResult = args.downgradeOnBypass
      ? { ...args.guardrailResult, status: "warn", blockedReason: "override_bypassed" }
      : args.guardrailResult;
    return { blocked: false, bypassed: true, guardrailResult };
  }
  return { blocked: true, bypassed: false, guardrailResult: args.guardrailResult };
  } finally {
    stopTimer();
  }
}
