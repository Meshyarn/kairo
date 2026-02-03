import type { FlowArtifactManager } from "../../flow-artifact-manager.js";
import { buildDegradedReasons } from "../../DegradedReasonMapper.js";

export const createApplyTokenState = (args: {
  applyPolicy: { oneTime: boolean };
  requireApplyToken: boolean;
  artifactManager?: FlowArtifactManager;
  draftId?: string;
  applyToken?: string;
  originalIntent: string;
  refinement?: string;
  getResolvedSessionId: () => string | undefined;
  getTargetFiles: () => string[];
  getRawEdits: () => any[];
}) => {
  let applyTokenConsumed = false;

  const validateApplyToken = (consume: boolean) => {
    const resolvedSessionId = args.getResolvedSessionId();
    return (resolvedSessionId && args.draftId && args.applyToken && args.artifactManager)
      ? args.artifactManager.validateApplyToken({
          sessionId: resolvedSessionId,
          draftId: args.draftId,
          token: args.applyToken,
          oneTime: args.applyPolicy.oneTime,
          consume
        })
      : { valid: false, reason: "missing" as const };
  };

  const buildApplyTokenBlockedResponse = (validation: any) => {
    const reasonCode = validation.reason === "expired"
      ? "apply_token_expired"
      : (validation.reason === "used"
        ? "apply_token_used"
        : (validation.reason === "invalid" ? "apply_token_invalid" : "apply_token_missing"));
    const message = reasonCode === "apply_token_expired"
      ? "Apply token expired. Re-run the plan to get a new token."
      : (reasonCode === "apply_token_used"
        ? "Apply token already used. Re-run the plan to get a new token."
        : (reasonCode === "apply_token_invalid"
          ? "Apply token invalid. Re-run the plan to get a new token."
          : "Apply token required to apply changes. Re-run the plan to get a token."));
    const nextArgs: Record<string, unknown> = {
      intent: args.originalIntent,
      safety: "plan"
    };
    const targetFiles = args.getTargetFiles();
    const rawEdits = args.getRawEdits();
    const resolvedSessionId = args.getResolvedSessionId();
    if (targetFiles.length > 0) nextArgs.targetFiles = targetFiles;
    if (rawEdits.length > 0) nextArgs.edits = rawEdits;
    if (args.refinement) nextArgs.refinement = args.refinement;
    if (resolvedSessionId) nextArgs.sessionId = resolvedSessionId;
    return {
      success: false,
      status: "blocked",
      message,
      errorCode: reasonCode === "apply_token_expired"
        ? "APPLY_TOKEN_EXPIRED"
        : (reasonCode === "apply_token_used"
          ? "APPLY_TOKEN_USED"
          : (reasonCode === "apply_token_invalid" ? "APPLY_TOKEN_INVALID" : "APPLY_TOKEN_MISSING")),
      blockedReason: reasonCode,
      degradedReasons: buildDegradedReasons([reasonCode]),
      guidance: {
        message,
        suggestedActions: [
          {
            id: "change.plan",
            priority: 1,
            description: "Re-plan the change to generate a fresh apply token.",
            rationale: "Apply requires a valid token generated during planning.",
            toolCall: { tool: "change", args: nextArgs }
          }
        ]
      },
      sessionId: resolvedSessionId
    };
  };

  const consumeApplyTokenOnce = () => {
    if (!args.requireApplyToken || applyTokenConsumed) return null;
    const validation = validateApplyToken(args.applyPolicy.oneTime);
    if (!validation.valid) {
      return buildApplyTokenBlockedResponse(validation);
    }
    applyTokenConsumed = true;
    return null;
  };

  return {
    validateApplyToken,
    buildApplyTokenBlockedResponse,
    consumeApplyTokenOnce
  };
};
