import fs from "fs";
import os from "os";
import path from "path";
import { SmartContextServer } from "../src/index.js";

type ToolResponse = { content?: Array<{ type: string; text?: string }>; isError?: boolean };

function writeJson(filePath: string, payload: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function writeText(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function readText(filePath: string) {
  return fs.readFileSync(filePath, "utf8");
}

function assert(condition: any, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function parseToolPayload(response: ToolResponse): any {
  const text = response.content?.[0]?.text;
  assert(typeof text === "string", "tool response content[0].text should be a string");
  return JSON.parse(text);
}

async function withFutureNow<T>(futureMs: number, fn: () => Promise<T>): Promise<T> {
  const originalNow = Date.now;
  (Date as any).now = () => futureMs;
  try {
    return await fn();
  } finally {
    (Date as any).now = originalNow;
  }
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-adr087-"));
  process.env.KAIRO_ROLLOUT_MODE = process.env.KAIRO_ROLLOUT_MODE ?? "legacy";
  process.env.KAIRO_METRICS_ENABLED = "false";
  process.env.KAIRO_BASELINE_ENABLED = "false";
  process.env.KAIRO_HEARTBEAT = "false";

  writeJson(path.join(tempRoot, ".kairo", "config", "mcp.json"), {
    version: 1,
    mode: "mcp",
    preset: "mcp-balanced",
    publicSurface: "compact",
    applyHandshake: {
      required: true,
      tokenTtlMs: 30 * 60 * 1000,
      oneTime: true,
      invalidateOnDrift: true
    },
    autopilot: {
      autoModeNeverApplies: true,
      defaultOutputFormat: "summary",
      maxAutoRepairAttempts: 0,
      allowAutoReindex: false
    }
  });

  writeText(
    path.join(tempRoot, "src", "app.ts"),
    [
      "import { signToken } from \"./auth/jwt\";",
      "",
      "export function main(userId: string) {",
      "  return signToken({ userId });",
      "}",
      ""
    ].join("\n")
  );
  writeText(
    path.join(tempRoot, "src", "auth", "jwt.ts"),
    [
      "export function signToken(payload: { userId: string }) {",
      "  return `token:${payload.userId}`;",
      "}",
      ""
    ].join("\n")
  );
  writeText(path.join(tempRoot, "README.md"), "# ADR-087 mock workspace\n");

  let server: SmartContextServer | undefined;
  try {
    server = new SmartContextServer(tempRoot);
    const callTool = async (name: string, args: any) =>
      (server as any).handleCallTool(name, args) as Promise<ToolResponse>;

    const waitForIndexHealthy = async () => {
      const startedAt = Date.now();
      while (true) {
        const statusRaw = await callTool("manage", { command: "status", detail: "summary", suppressLogs: true });
        const status = parseToolPayload(statusRaw);
        const snapshot = status?.result?.indexSnapshot;
        const dirty = Number(snapshot?.dirtyFileCount ?? 0);
        const staleRisk = snapshot?.staleRisk;
        if (dirty === 0 && staleRisk !== "high") return;
        if (Date.now() - startedAt > 60_000) {
          throw new Error(`index did not become healthy within 60s (dirty=${dirty}, staleRisk=${String(staleRisk)})`);
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    };

    const reindex = async () => {
      await callTool("manage", { command: "reindex", suppressLogs: true });
      await waitForIndexHealthy();
    };

    const isIndexStaleBlocked = (payload: any) => {
      const details = payload?.details?.response;
      return (
        payload?.status === "blocked" &&
        (payload?.blockedReason === "index_stale_high" ||
          details?.blockedReason === "index_stale_high" ||
          payload?.errorCode === "INDEX_STALE_HIGH" ||
          details?.errorCode === "INDEX_STALE_HIGH")
      );
    };

    const callTaskWithReindexRetry = async (args: any) => {
      const first = await callTaskParsed(args);
      if (!isIndexStaleBlocked(first)) return first;
      await reindex();
      return callTaskParsed(args);
    };

    const callTaskParsed = async (args: any) => parseToolPayload(await callTool("task", args));

    await reindex();

    // 1) lean ask → LOD-1 style evidence (ranked files only; no excerpts; no evidence artifact)
    const leanAsk = await callTaskParsed({ request: "app entrypoint", mode: "ask", budget: "lean", paths: ["src"] });
    assert(Array.isArray(leanAsk.evidence) && leanAsk.evidence.length > 0, "lean ask should return evidence");
    assert(!leanAsk.evidence.some((item: any) => typeof item?.excerpt === "string"), "lean ask evidence should not include excerpts");
    assert(!leanAsk.artifacts?.some((artifact: any) => artifact?.kind === "evidence"), "lean ask should not create evidence artifact");

    // 2) balanced ask → excerpts present (LOD-2+)
    const balancedAsk = await callTaskParsed({ request: "app entrypoint", mode: "ask", budget: "balanced", paths: ["src"] });
    assert(Array.isArray(balancedAsk.evidence) && balancedAsk.evidence.length > 0, "balanced ask should return evidence");
    assert(balancedAsk.evidence.some((item: any) => typeof item?.excerpt === "string"), "balanced ask evidence should include excerpts");

    // 3) output.format standard vs summary
    const standardAsk = await callTaskParsed({
      request: "app entrypoint",
      mode: "ask",
      budget: "lean",
      output: { format: "standard" }
    });
    assert(standardAsk.details?.pillar === "explore", "standard output should include pillar details");
    const summaryAsk = await callTaskParsed({
      request: "app entrypoint",
      mode: "ask",
      budget: "lean",
      output: { format: "summary" }
    });
    assert(!summaryAsk.details, "summary output should omit details");

    // 4) decisionTrace emission when trace enabled
    const tracedAsk = await callTaskParsed({
      request: "app entrypoint",
      mode: "ask",
      budget: "lean",
      trace: true
    });
    assert(tracedAsk.decisionTrace?.version === 1, "trace enabled should include decisionTrace");
    assert(tracedAsk.decisionTrace?.pillar === "task", "decisionTrace should identify task pillar");

    // 5) composite read-only flow (insufficient evidence -> explore→understand)
    const compositeAsk = await callTaskParsed({
      request: "app details",
      mode: "ask",
      budget: "balanced",
      targetFiles: ["src/app.ts"],
      paths: ["src/app.ts"]
    });
    assert(compositeAsk.status === "partial_success", "composite ask should return partial_success when evidence is insufficient");
    assert(
      Array.isArray(compositeAsk.summary?.bullets) && compositeAsk.summary.bullets.some((bullet: string) => bullet.startsWith("Deep analysis:")),
      "composite ask should include Deep analysis summary"
    );
    assert(
      Array.isArray(compositeAsk.summary?.bullets) &&
        compositeAsk.summary.bullets.some((bullet: string) => bullet.startsWith("Decision gate: insufficient evidence")),
      "composite ask should include decision gate summary"
    );
    assert(
      Array.isArray(compositeAsk.guidance?.nextCalls) && compositeAsk.guidance.nextCalls.some((call: any) => call?.tool === "task"),
      "composite ask should return nextCalls in compact surface"
    );
    if (Array.isArray(compositeAsk.guidance?.nextCalls)) {
      const nonCompact = compositeAsk.guidance.nextCalls.find((call: any) => call?.tool && call.tool !== "task" && call.tool !== "manage");
      assert(!nonCompact, "composite ask nextCalls should be compact-safe (task/manage only)");
    }

    // 6) deep analyze → evidence artifact retrievable via manage
    const deepAnalyze = await callTaskParsed({ request: "explain auth flow", mode: "analyze", budget: "deep" });
    const evidenceId = deepAnalyze.artifacts?.find((artifact: any) => artifact?.kind === "evidence")?.id;
    assert(typeof evidenceId === "string" && evidenceId.length > 0, "deep analyze should include an evidence artifact id");

    const evidenceFull = parseToolPayload(
      await callTool("manage", { command: "artifact", target: evidenceId, detail: "full", suppressLogs: true })
    );
    const view = evidenceFull?.result?.view;
    assert(Array.isArray(view?.evidence) && view.evidence.length > 0, "manage artifact(full) should return evidence items");
    assert(Array.isArray(view?.rankedFiles) && view.rankedFiles.length > 0, "manage artifact(full) should return ranked files");

    const evidenceSummary = parseToolPayload(
      await callTool("manage", { command: "artifact", target: evidenceId, detail: "summary", suppressLogs: true })
    );
    const summaryView = evidenceSummary?.result?.view;
    assert(summaryView?.detail === "summary", "manage artifact(summary) should return summary view");
    assert(Array.isArray(summaryView?.evidence) && summaryView.evidence.length <= 3, "summary view should cap evidence items");
    assert(Array.isArray(summaryView?.rankedFiles) && summaryView.rankedFiles.length <= 10, "summary view should cap ranked files");
    assert(summaryView?.caps?.maxItems >= summaryView.evidence.length, "summary view should include caps");

    const missingArtifact = parseToolPayload(
      await callTool("manage", { command: "artifact", target: "evidence_missing", detail: "summary", suppressLogs: true })
    );
    assert(missingArtifact?.result?.success === false, "manage artifact should fail on missing id");

    // 7) deep ask with insufficient evidence should include continuation in evidence pack
    const deepInsufficient = await callTaskParsed({
      request: "app details (insufficient)",
      mode: "ask",
      budget: "deep",
      targetFiles: ["src/app.ts"],
      paths: ["src/app.ts"]
    });
    assert(deepInsufficient.status === "partial_success", "deep insufficient ask should be partial_success");
    const deepEvidenceId = deepInsufficient.artifacts?.find((artifact: any) => artifact?.kind === "evidence")?.id;
    assert(typeof deepEvidenceId === "string" && deepEvidenceId.length > 0, "deep insufficient ask should include evidence artifact");
    const deepEvidence = parseToolPayload(
      await callTool("manage", { command: "artifact", target: deepEvidenceId, detail: "summary", suppressLogs: true })
    );
    const continuation = deepEvidence?.result?.artifact?.pack?.continuation;
    assert(Array.isArray(continuation?.nextCalls) && continuation.nextCalls.length > 0, "evidence pack should include continuation nextCalls");
    assert(continuation.nextCalls.some((call: any) => call?.tool === "task"), "continuation should include task nextCall");

    // 8) response envelope enforcement (maxChars)
    const cappedAsk = await callTaskParsed({
      request: "explain auth flow in detail",
      mode: "ask",
      budget: "deep",
      output: { maxChars: 200 }
    });
    assert(cappedAsk.stats?.responseBudget?.applied === true, "responseBudget should be applied when maxChars is too small");
    assert(
      Array.isArray(cappedAsk.degradedReasons) && cappedAsk.degradedReasons.some((reason: any) => reason?.type === "budget_exceeded"),
      "budget_exceeded should be reported when envelope is enforced"
    );

    // 9) plan_change prep should include targetStringCandidates (anchor extraction)
    const changePrep = await callTaskParsed({
      request: "Update signToken to include issuer.",
      mode: "plan_change",
      budget: "balanced",
      targetFiles: ["src/auth/jwt.ts"]
    });
    const candidates = changePrep.changePrep?.targetStringCandidates ?? [];
    assert(candidates.length > 0, "plan_change prep should return targetStringCandidates");
    assert(
      typeof candidates[0]?.anchorText === "string" && candidates[0].anchorText.includes("signToken"),
      "targetStringCandidates should include anchor text around signToken"
    );
    assert(!candidates[0]?.anchorText?.includes("…"), "anchorText should not be truncated with ellipsis");

    // 10) write plan prep without explicit content
    const writePrep = await callTaskParsed({
      request: "Create a helper to format user ids.",
      mode: "write",
      budget: "balanced",
      targetPath: "src/helpers/format.ts"
    });
    assert(
      Array.isArray(writePrep.evidence) && writePrep.evidence.length > 0,
      "write plan prep should return evidence when no explicit content provided"
    );

    // 11) apply_change prep (plan -> verify mismatch)
    const changePlan = await callTaskParsed({
      request: "Change signToken output format.",
      mode: "plan_change",
      targetFiles: ["src/auth/jwt.ts"],
      edits: [
        {
          filePath: "src/auth/jwt.ts",
          targetString: "  return `token:${payload.userId}`;\n",
          replacementString: "  return `token:${payload.userId}:v2`;\n"
        }
      ]
    });
    assert(typeof changePlan.draftId === "string", "change plan should return draftId");
    assert(typeof changePlan.applyToken === "string", "change plan should return applyToken");
    const changeSessionId = changePlan.sessionId;

    const preVerify = await callTaskParsed({
      request: "Verify draft before apply.",
      mode: "verify",
      budget: "balanced",
      targetPath: "src/auth/jwt.ts",
      draftId: changePlan.draftId,
      sessionId: typeof changeSessionId === "string" ? changeSessionId : undefined
    });
    assert(preVerify.status === "partial_success", "verify before apply should be partial_success");
    assert(preVerify.verification?.contentMatch === false, "verify before apply should detect content mismatch");

    const verifyMissing = await callTaskParsed({
      request: "Verify missing file and draft.",
      mode: "verify",
      budget: "balanced",
      targetPath: "src/missing.ts",
      draftId: "draft_missing"
    });
    assert(verifyMissing.status === "blocked", "verify missing file should be blocked");
    assert(
      Array.isArray(verifyMissing.degradedReasons) && verifyMissing.degradedReasons.some((reason: any) => reason?.message === "file_missing"),
      "verify missing file should report file_missing"
    );
    assert(
      Array.isArray(verifyMissing.degradedReasons) && verifyMissing.degradedReasons.some((reason: any) => reason?.message === "draft_missing"),
      "verify missing draft should report draft_missing"
    );

    const verifyMissingDraftOnly = await callTaskParsed({
      request: "Verify missing draft only.",
      mode: "verify",
      budget: "balanced",
      targetPath: "src/auth/jwt.ts",
      draftId: "draft_missing_only"
    });
    assert(verifyMissingDraftOnly.status === "blocked", "verify missing draft should be blocked");
    assert(
      Array.isArray(verifyMissingDraftOnly.degradedReasons) &&
        verifyMissingDraftOnly.degradedReasons.some((reason: any) => reason?.message === "draft_missing"),
      "verify missing draft should report draft_missing"
    );

    const missingApply = await callTaskParsed({
      request: "Apply change plan without token.",
      mode: "apply_change",
      budget: "balanced",
      output: { format: "standard" },
      draftId: changePlan.draftId,
      sessionId: typeof changeSessionId === "string" ? changeSessionId : undefined,
      targetFiles: ["src/auth/jwt.ts"]
    });
    assert(missingApply.status === "blocked", "apply_change without token should be blocked");
    const missingReason = missingApply.details?.response?.blockedReason ?? missingApply.details?.response?.errorCode;
    assert(
      missingReason === "apply_token_missing" || missingReason === "APPLY_TOKEN_MISSING",
      "apply_change without token should report missing token"
    );

    const invalidApply = await callTaskParsed({
      request: "Apply change plan with invalid token.",
      mode: "apply_change",
      budget: "balanced",
      output: { format: "standard" },
      draftId: changePlan.draftId,
      applyToken: "invalid_token",
      sessionId: typeof changeSessionId === "string" ? changeSessionId : undefined,
      targetFiles: ["src/auth/jwt.ts"]
    });
    assert(invalidApply.status === "blocked", "apply_change invalid token should be blocked");

    // 12) apply_change auto-verify (plan -> apply)
    const changeApply = await callTaskWithReindexRetry({
      request: "Apply change plan.",
      mode: "apply_change",
      budget: "balanced",
      draftId: changePlan.draftId,
      applyToken: changePlan.applyToken,
      sessionId: typeof changeSessionId === "string" ? changeSessionId : undefined,
      targetFiles: ["src/auth/jwt.ts"]
    });
    assert(changeApply.status === "success", "apply_change should succeed");
    assert(changeApply.verification?.contentMatch === true, "apply_change should include verification contentMatch");
    const updatedJwt = readText(path.join(tempRoot, "src", "auth", "jwt.ts"));
    assert(updatedJwt.includes(":v2"), "apply_change should update file content");

    const reuseApply = await callTaskParsed({
      request: "Apply change plan again with same token.",
      mode: "apply_change",
      budget: "balanced",
      output: { format: "standard" },
      draftId: changePlan.draftId,
      applyToken: changePlan.applyToken,
      sessionId: typeof changeSessionId === "string" ? changeSessionId : undefined,
      targetFiles: ["src/auth/jwt.ts"]
    });
    assert(reuseApply.status === "blocked", "apply_change token reuse should be blocked");

    const expirePlan = await callTaskParsed({
      request: "Change signToken output format again.",
      mode: "plan_change",
      targetFiles: ["src/auth/jwt.ts"],
      edits: [
        {
          filePath: "src/auth/jwt.ts",
          targetString: "  return `token:${payload.userId}:v2`;\n",
          replacementString: "  return `token:${payload.userId}:v3`;\n"
        }
      ]
    });
    assert(typeof expirePlan.draftId === "string", "expire plan should return draftId");
    assert(typeof expirePlan.applyToken === "string", "expire plan should return applyToken");
    const expireSessionId = expirePlan.sessionId;
    const expireAt = typeof expirePlan.applyTokenExpiresAt === "number"
      ? expirePlan.applyTokenExpiresAt + 1000
      : Date.now() + 31 * 60 * 1000;
    const expiredApply = await withFutureNow(expireAt, async () =>
      callTaskParsed({
        request: "Apply expired change plan.",
        mode: "apply_change",
        budget: "balanced",
        output: { format: "standard" },
        draftId: expirePlan.draftId,
        applyToken: expirePlan.applyToken,
        sessionId: typeof expireSessionId === "string" ? expireSessionId : undefined,
        targetFiles: ["src/auth/jwt.ts"]
      })
    );
    assert(expiredApply.status === "blocked", "apply_change expired token should be blocked");
    const expiredReason = expiredApply.details?.response?.blockedReason ?? expiredApply.details?.response?.errorCode;
    assert(
      expiredReason === "apply_token_expired" || expiredReason === "APPLY_TOKEN_EXPIRED",
      "apply_change expired token should report expired reason"
    );
    const expiredCheck = readText(path.join(tempRoot, "src", "auth", "jwt.ts"));
    assert(!expiredCheck.includes(":v3"), "expired apply should not change file");

    const postVerify = await callTaskParsed({
      request: "Verify draft after apply.",
      mode: "verify",
      budget: "balanced",
      targetPath: "src/auth/jwt.ts",
      draftId: changePlan.draftId,
      sessionId: typeof changeSessionId === "string" ? changeSessionId : undefined
    });
    assert(postVerify.status === "success", "verify after apply should succeed");
    assert(postVerify.verification?.contentMatch === true, "verify after apply should match content");

    // 13) write apply auto-verify (plan -> apply)
    const writePlan = await callTaskParsed({
      request: "Create generated file.\n```ts\nexport const generated = 123;\n```",
      mode: "write",
      targetPath: "src/generated.ts"
    });
    assert(typeof writePlan.draftId === "string", "write plan should return draftId");
    assert(typeof writePlan.applyToken === "string", "write plan should return applyToken");
    const writeSessionId = writePlan.sessionId;

    const missingWriteApply = await callTaskParsed({
      request: "Apply write plan without token.",
      mode: "write",
      budget: "balanced",
      safety: "apply",
      targetPath: "src/generated.ts",
      draftId: writePlan.draftId,
      sessionId: typeof writeSessionId === "string" ? writeSessionId : undefined
    });
    assert(missingWriteApply.status === "blocked", "write apply without token should be blocked");

    const writeApply = await callTaskWithReindexRetry({
      request: "Apply write plan.",
      mode: "write",
      budget: "balanced",
      safety: "apply",
      targetPath: "src/generated.ts",
      draftId: writePlan.draftId,
      applyToken: writePlan.applyToken,
      sessionId: typeof writeSessionId === "string" ? writeSessionId : undefined
    });
    assert(writeApply.status === "success", "write apply should succeed");
    assert(writeApply.verification?.contentMatch === true, "write apply should include verification contentMatch");
    const generated = readText(path.join(tempRoot, "src", "generated.ts"));
    assert(generated.includes("export const generated = 123;"), "write apply should write file content");

    console.log("[ADR-087 mock] OK:", {
      tempRoot,
      leanEvidence: leanAsk.evidence.length,
      balancedEvidence: balancedAsk.evidence.length,
      evidenceId
    });
  } finally {
    if (server) {
      await server.shutdown().catch(() => undefined);
    }
  }
}

main()
  .then(() => {
    // SmartContextServer leaves some long-lived handles (watchers/timers) in certain configs.
    // For a smoke script, force exit once assertions + shutdown completed.
    process.exit(process.exitCode ?? 0);
  })
  .catch((error) => {
    console.error("[ADR-087 mock] FAILED:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
