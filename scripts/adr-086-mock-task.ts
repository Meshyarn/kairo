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

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-adr086-"));
  process.env.KAIRO_ROLLOUT_MODE = process.env.KAIRO_ROLLOUT_MODE ?? "legacy";
  process.env.KAIRO_METRICS_ENABLED = "false";
  process.env.KAIRO_BASELINE_ENABLED = "false";
  const mcpPath = path.join(tempRoot, ".kairo", "config", "mcp.json");
  writeJson(mcpPath, {
    version: 1,
    mode: "mcp",
    preset: "mcp-lean",
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

  const changeFileRel = "src/adr086/change.ts";
  const writeFileRel = "src/adr086/generated.ts";
  const autoFileRel = "src/adr086/auto.ts";

  writeText(path.join(tempRoot, changeFileRel), "export const value = 1;\n");

  const server = new SmartContextServer(tempRoot);
  const callTool = async (name: string, args: any) =>
    (server as any).handleCallTool(name, args) as Promise<ToolResponse>;

  try {
    const waitForIndexHealthy = async () => {
      const startedAt = Date.now();
      while (true) {
        const statusRaw = await callTool("manage", { command: "status", detail: "summary" });
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

    const reindex = async (paths?: string[]) => {
      const args: any = { command: "reindex" };
      if (Array.isArray(paths) && paths.length > 0) {
        args.paths = Array.from(new Set(paths.filter(Boolean)));
      }
      const startRaw = await callTool("manage", args);
      const start = parseToolPayload(startRaw);
      const startOutput = String(start?.result?.output ?? start?.result?.message ?? "");
      if (start?.success === false && !startOutput.toLowerCase().includes("already in progress")) {
        throw new Error(`manage reindex failed: ${startOutput || "unknown error"}`);
      }
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

    const callTaskParsed = async (args: any) => parseToolPayload(await callTool("task", args));
    const dumpApplyTokenState = async (label: string, sessionId?: string, draftId?: string) => {
      if (!sessionId || !draftId) return;
      const sessionRaw = await callTool("manage", { command: "session", target: sessionId });
      const session = parseToolPayload(sessionRaw);
      const record = session?.result?.session?.applyTokens?.[draftId];
      console.log(
        `[ADR-086 mock] ${label} applyTokenRecord:`,
        record
          ? { draftId: record.draftId, usedAt: record.usedAt ?? null, issuedAt: record.issuedAt, expiresAt: record.expiresAt }
          : null
      );
    };
    const callTaskWithReindexRetry = async (args: any, label: string) => {
      const first = await callTaskParsed(args);
      if (!isIndexStaleBlocked(first)) return first;
      console.log(`[ADR-086 mock] ${label}: blocked by INDEX_STALE_HIGH → manage reindex → retry apply`);
      console.log(`[ADR-086 mock] ${label} first payload:`, JSON.stringify(first, null, 2));
      await dumpApplyTokenState(`${label} (before reindex)`, args?.sessionId, args?.draftId);
      const reindexPaths: string[] = [];
      if (typeof args?.targetPath === "string") reindexPaths.push(args.targetPath);
      if (Array.isArray(args?.targetFiles)) reindexPaths.push(...args.targetFiles);
      // Keep it simple: include the files this mock touches to clear dirty markers in tiny workspaces.
      reindexPaths.push(writeFileRel, changeFileRel);
      await reindex(reindexPaths);
      await dumpApplyTokenState(`${label} (after reindex)`, args?.sessionId, args?.draftId);
      return callTaskParsed(args);
    };

    // Preflight: avoid doing a full reindex (it runs async); rely on reindex-on-block logic instead.

    // 1) task(mode=write) plan → returns draftId/applyToken, guidance rewritten to task/manage
    const writeRequest = `Create ${writeFileRel} with this content:\n\n\`\`\`ts\nexport const generated = 123;\n\`\`\``;
    const writePlanRaw = await callTool("task", {
      request: writeRequest,
      mode: "write",
      safety: "plan",
      targetPath: writeFileRel
    });
    const writePlan = parseToolPayload(writePlanRaw);
    assert(writePlan.mode === "write", "write plan should return mode=write");
    assert(writePlan.status === "success", "write plan should succeed");
    assert(typeof writePlan.draftId === "string" && writePlan.draftId.length > 0, "write plan should return draftId");
    assert(typeof writePlan.applyToken === "string" && writePlan.applyToken.length > 0, "write plan should return applyToken");
    assert(
      writePlan.guidance?.suggestedActions?.some((a: any) => a?.toolCall?.tool === "task"),
      "write plan guidance should contain task toolCalls on compact surface"
    );

    // 2) task(mode=write) apply → writes draft content
    const writeApply = await callTaskWithReindexRetry({
      request: writeRequest,
      mode: "write",
      safety: "apply",
      targetPath: writeFileRel,
      output: { format: "standard" },
      sessionId: writePlan.sessionId,
      draftId: writePlan.draftId,
      applyToken: writePlan.applyToken
    }, "write apply");
    if (writeApply.status !== "success") {
      console.log("[ADR-086 mock] write apply payload:", JSON.stringify(writeApply, null, 2));
    }
    assert(writeApply.status === "success", "write apply should succeed");
    const written = readText(path.join(tempRoot, writeFileRel));
    assert(written.includes("export const generated = 123;"), "write apply should write drafted content");
    // Stabilize tiny workspaces: a single dirty file can trip the stale guard for subsequent applies.
    await reindex([writeFileRel, changeFileRel]);

    // 3) task(mode=verify) → draft match
    const verifyWriteRaw = await callTool("task", {
      request: "verify write",
      mode: "verify",
      targetPath: writeFileRel,
      draftId: writePlan.draftId
    });
    const verifyWrite = parseToolPayload(verifyWriteRaw);
    assert(verifyWrite.status === "success", "verify(write) should succeed");
    assert(verifyWrite.verification?.contentMatch === true, "verify(write) should report draft contentMatch=true");

    // 4) task(mode=plan_change) with explicit edits → returns draftId/applyToken + guidance rewritten to task/manage
    const changeRequest = `Refactor ${changeFileRel}: change value from 1 to 2.`;
    const changePlanRaw = await callTool("task", {
      request: changeRequest,
      mode: "plan_change",
      targetFiles: [changeFileRel],
      edits: [
        {
          filePath: changeFileRel,
          targetString: "export const value = 1;\n",
          replacementString: "export const value = 2;\n"
        }
      ]
    });
    const changePlan = parseToolPayload(changePlanRaw);
    assert(changePlan.status === "success", "change plan should succeed");
    assert(typeof changePlan.draftId === "string" && changePlan.draftId.length > 0, "change plan should return draftId");
    assert(typeof changePlan.applyToken === "string" && changePlan.applyToken.length > 0, "change plan should return applyToken");
    assert(
      changePlan.guidance?.suggestedActions?.some((a: any) => a?.toolCall?.tool === "task"),
      "change plan guidance should contain task toolCalls on compact surface"
    );

    // 5) task(mode=apply_change) apply → edits file
    const changeApply = await callTaskWithReindexRetry({
      request: changeRequest,
      mode: "apply_change",
      targetFiles: [changeFileRel],
      edits: [
        {
          filePath: changeFileRel,
          targetString: "export const value = 1;\n",
          replacementString: "export const value = 2;\n"
        }
      ],
      output: { format: "standard" },
      sessionId: changePlan.sessionId,
      draftId: changePlan.draftId,
      applyToken: changePlan.applyToken
    }, "change apply");
    if (changeApply.status !== "success") {
      console.log("[ADR-086 mock] change apply payload:", JSON.stringify(changeApply, null, 2));
    }
    assert(changeApply.status === "success", "change apply should succeed");
    const changed = readText(path.join(tempRoot, changeFileRel));
    assert(changed.includes("export const value = 2;"), "change apply should update the file");

    // 6) verify(change) → draft match
    const verifyChangeRaw = await callTool("task", {
      request: "verify change",
      mode: "verify",
      targetFiles: [changeFileRel],
      draftId: changePlan.draftId
    });
    const verifyChange = parseToolPayload(verifyChangeRaw);
    if (verifyChange.status !== "success") {
      console.log("[ADR-086 mock] verify(change) payload:", JSON.stringify(verifyChange, null, 2));
    }
    assert(verifyChange.status === "success", "verify(change) should succeed");
    assert(verifyChange.verification?.contentMatch === true, "verify(change) should report draft contentMatch=true");

    // 7) task(mode=auto) routes write intent → mode=write
    const autoRequest = `Create ${autoFileRel} with this content:\n\n\`\`\`ts\nexport const auto = true;\n\`\`\``;
    const autoWriteRaw = await callTool("task", {
      request: autoRequest,
      targetPath: autoFileRel
    });
    const autoWrite = parseToolPayload(autoWriteRaw);
    assert(autoWrite.mode === "write", "auto routing should resolve write intent to mode=write");

    console.log("[ADR-086 mock] OK");
    console.log(`tempRoot=${tempRoot}`);
  } finally {
    await server.shutdown();
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
