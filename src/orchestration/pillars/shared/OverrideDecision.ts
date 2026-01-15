import { AuditLog } from "../../../utils/AuditLog.js";
import {
  detectOverrideRequirementsFromConstraints,
  evaluateOverride,
  type OverrideTrace
} from "../../../utils/GuardrailsOverride.js";

type OverrideBlockedResponse = {
  success: false;
  status: "blocked";
  message: string;
  errorCode?: string;
  blockedReason?: string;
  guidance: { message: string };
};

export type OverrideDecisionResult = {
  decision: ReturnType<typeof evaluateOverride> | null;
  trace?: OverrideTrace;
  bypass: {
    integrityGuardrails: boolean;
    reviewPolicy: boolean;
    staleGuard: boolean;
  };
  blockedResponse?: OverrideBlockedResponse;
};

export async function evaluateOverrideDecision(params: {
  constraints: Record<string, any>;
  targetFiles: string[];
  pillar: "change" | "write";
  repoId?: string;
  auditLogAppend?: typeof AuditLog.append;
}): Promise<OverrideDecisionResult> {
  const auditLogAppend = params.auditLogAppend ?? AuditLog.append;
  const decision = evaluateOverride({
    override: params.constraints.override,
    requiredOverrides: detectOverrideRequirementsFromConstraints(params.constraints),
    targetFiles: params.targetFiles,
    pillar: params.pillar,
    repoId: params.repoId
  });
  const bypass = {
    integrityGuardrails: decision?.effectiveAllow?.["integrityGuardrails.bypass"] === true,
    reviewPolicy: decision?.effectiveAllow?.["reviewPolicy.bypassPreApplyBlock"] === true,
    staleGuard: decision?.effectiveAllow?.["staleGuard.bypass"] === true
  };
  if (!decision) {
    return { decision: null, bypass };
  }

  const auditEventId = await auditLogAppend({
    pillar: params.pillar,
    operation: "override_check",
    decision: decision.decision,
    actor: decision.approval?.approvedBy,
    reason: decision.approval?.reason,
    ticket: decision.approval?.ticket,
    scope: decision.scope,
    requested: decision.requestedAllow,
    effective: decision.effectiveAllow,
    targetFiles: params.targetFiles,
    result: decision.errorCode
      ? { success: false, status: "blocked", errorCode: decision.errorCode }
      : undefined
  });
  const trace: OverrideTrace = {
    auditEventId,
    decision: decision.decision,
    overridesUsed: decision.overridesUsed,
    expiresAt: decision.approval?.expiresAt
  };
  const blockedResponse: OverrideBlockedResponse | undefined = decision.errorCode
    ? {
        success: false,
        status: "blocked",
        message: decision.message,
        errorCode: decision.errorCode,
        blockedReason: decision.blockedReason,
        guidance: { message: decision.message }
      }
    : undefined;
  return { decision, trace, bypass, blockedResponse };
}
