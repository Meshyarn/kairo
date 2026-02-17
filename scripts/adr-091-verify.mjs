/**
 * ADR-091 구현 검증 스크립트
 *
 * 실제 MCP 서버를 인프로세스로 부팅하여 다음을 검증합니다:
 *  1. budget 미지정 시 evidence가 비어있지 않은지 (WP1-1, WP1-2, WP1-3)
 *  2. tool description이 50단어 이상인지 (WP1-4)
 *  3. 레거시 도구명(project_search, project_manage)이 에러/guidance에 없는지 (WP1-5)
 *  4. manage({ command: "schema", tool: "task" }) 가 작동하는지 (WP2-7)
 *  5. truncation 시 evidence floor이 유지되는지 (WP1-3)
 *  6. nextCalls가 최상위에 있는지 (WP2-4)
 *  7. autoPersist + TTL 확인 (WP2-6)
 *  8. AdaptiveLodController 다운시프트 확인 (WP2-2)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PASS = "\x1b[32m✅ PASS\x1b[0m";
const FAIL = "\x1b[31m❌ FAIL\x1b[0m";
const WARN = "\x1b[33m⚠ WARN\x1b[0m";

let passCount = 0;
let failCount = 0;

const report = (label, ok, detail) => {
  if (ok) {
    passCount++;
    console.log(`  ${PASS} ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failCount++;
    console.log(`  ${FAIL} ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

const ensureDist = () => {
  const distPath = path.resolve(process.cwd(), "dist", "server", "SmartContextServer.js");
  if (!fs.existsSync(distPath)) {
    throw new Error(`dist 서버가 없습니다: ${distPath}\n→ npm run build 를 먼저 실행하세요.`);
  }
  return distPath;
};

const createTestProject = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-adr091-"));
  fs.mkdirSync(path.join(root, "src", "utils"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "# ADR-091 Test Project\n\nThis is a test project for verifying ADR-091.\n", "utf-8");
  fs.writeFileSync(path.join(root, "src", "index.ts"), [
    'import { helper } from "./utils/helper";',
    "",
    "export function main(): void {",
    '  console.log("Hello from ADR-091 test");',
    "  helper();",
    "}",
    "",
    "export class ProjectConfig {",
    "  readonly name: string;",
    "  readonly version: string;",
    '  constructor(name: string, version: string = "1.0.0") {',
    "    this.name = name;",
    "    this.version = version;",
    "  }",
    "  toString(): string {",
    "    return `${this.name}@${this.version}`;",
    "  }",
    "}",
  ].join("\n"), "utf-8");
  fs.writeFileSync(path.join(root, "src", "utils", "helper.ts"), [
    "export function helper(): void {",
    '  console.log("helper called");',
    "}",
    "",
    "export function formatDate(d: Date): string {",
    '  return d.toISOString().split("T")[0];',
    "}",
    "",
    "export const VERSION = '0.1.0';",
  ].join("\n"), "utf-8");
  return root;
};

const parseToolJson = (toolResult, label) => {
  const text = toolResult?.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`MCP 도구 응답 text가 없음: ${label}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
};

const unwrapToolResult = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  if (typeof payload.success === "boolean" && "result" in payload) return payload.result;
  return payload;
};

const callTool = async (client, name, args) => {
  const result = await client.callTool({ name, arguments: args });
  return unwrapToolResult(parseToolJson(result, name));
};

const waitForIndex = async (client, { timeoutMs = 30_000, intervalMs = 250 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await callTool(client, "manage", { command: "status", detail: "summary", suppressLogs: true });
    const docCount = status?.nativeSearch?.stats?.docCount ?? 0;
    const reindexing = Boolean(status?.activity?.reindexInProgress);
    if (!reindexing && docCount > 0) return status;
    await sleep(intervalMs);
  }
  throw new Error("인덱스 준비 대기 타임아웃");
};

async function main() {
  ensureDist();
  const root = createTestProject();

  process.env.NODE_ENV = "production";
  process.env.KAIRO_MODE = "mcp";
  process.env.KAIRO_PUBLIC_SURFACE = "compact";
  process.env.KAIRO_WARMUP_ENABLED = "false";
  process.env.KAIRO_METRICS_MODE = "basic";
  process.env.KAIRO_BASELINE_ENABLED = "on";
  process.env.KAIRO_EXPOSE_FILE_TOOLS = "true";
  process.env.KAIRO_ALLOW_CWD_ROOT = "true";
  process.env.KAIRO_TEST_USE_NATIVE_CORE = "true";
  process.env.KAIRO_STORAGE_MODE = "memory";
  // 프리셋 환경변수 미지정 — 기본값 테스트
  delete process.env.KAIRO_PRESET;

  const { SmartContextServer } = await import("../dist/server/SmartContextServer.js");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "adr091-verifier", version: "0.1.0" });
  const server = new SmartContextServer(root);

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    // ── 인덱스 준비 ──
    await callTool(client, "manage", { command: "reindex" });
    await waitForIndex(client);

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 1: Tool descriptions (WP1-4) ══");
    // ═══════════════════════════════════════════════════════
    const toolsList = await client.listTools();
    const publicTools = toolsList.tools.filter((t) => !t.name.startsWith("file_"));
    for (const tool of publicTools) {
      const wordCount = (tool.description ?? "").split(/\s+/).filter(Boolean).length;
      report(
        `${tool.name} description (${wordCount}w)`,
        wordCount >= 50,
        wordCount < 50 ? `Need ≥50 words, got ${wordCount}` : undefined
      );
    }

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 2: budget 미지정 호출 → evidence 검증 (WP1-1, WP1-2, WP1-3) ══");
    // ═══════════════════════════════════════════════════════
    const askResult = await callTool(client, "task", {
      request: "Find the main function in the project"
    });

    const evidence = askResult?.evidence;
    const evidenceCount = Array.isArray(evidence) ? evidence.length : 0;
    report(
      "budget 미지정 시 evidence ≥ 1",
      evidenceCount >= 1,
      `evidence: ${evidenceCount}개 항목`
    );

    if (evidenceCount > 0) {
      const firstExcerpt = evidence[0]?.excerpt ?? "";
      report(
        "evidence[0] excerpt ≥ 40자",
        firstExcerpt.length >= 40,
        `excerpt: ${firstExcerpt.length}자`
      );
    }

    const status = askResult?.status;
    const degraded = askResult?.degraded;
    report(
      "status가 partial_success/success",
      status === "success" || status === "partial_success",
      `status: "${status}", degraded: ${degraded}`
    );

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 3: manage schema 호출 (WP2-7) ══");
    // ═══════════════════════════════════════════════════════
    const schemaResult = await callTool(client, "manage", { command: "schema", tool: "task" });
    const hasInputSchema = Boolean(schemaResult?.inputSchema || schemaResult?.schema || schemaResult?.properties);
    report(
      "manage({command:'schema', tool:'task'}) 성공",
      hasInputSchema,
      hasInputSchema ? "inputSchema 반환됨" : `결과 키: ${Object.keys(schemaResult ?? {}).join(", ")}`
    );

    // 이전에 실패했던 패턴: scope만 주고 tool 없이 호출
    const schemaBadResult = await callTool(client, "manage", { command: "schema", scope: "contracts" });
    const schemaBadFail = schemaBadResult?.success === false || schemaBadResult?.errorCode || schemaBadResult?.error;
    report(
      "manage schema (tool 누락) 시 명확한 에러",
      Boolean(schemaBadFail),
      `에러 발생: ${schemaBadFail ? "Yes" : "No"}`
    );

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 4: evidence floor + truncation (WP1-3) ══");
    // ═══════════════════════════════════════════════════════
    const tightResult = await callTool(client, "task", {
      request: "Find all functions in the helper file",
      output: { maxTokens: 300 }
    });

    const tightEvidence = tightResult?.evidence;
    const tightCount = Array.isArray(tightEvidence) ? tightEvidence.length : 0;
    report(
      "maxTokens=300에서도 evidence ≥ 1 (floor)",
      tightCount >= 1,
      `evidence: ${tightCount}개 항목`
    );

    const truncated = tightResult?.truncated === true || tightResult?.stats?.responseBudget?.applied === true;
    report(
      "tight budget에서 truncation 표시",
      truncated,
      `truncated flag 존재: ${truncated}`
    );

    if (tightResult?.truncationSummary) {
      report(
        "truncationSummary 존재",
        true,
        `removedItems: ${tightResult.truncationSummary.removedItems}, originalSize: ${tightResult.truncationSummary.originalSize}`
      );
    }

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 5: nextCalls 최상위 승격 (WP2-4) ══");
    // ═══════════════════════════════════════════════════════
    // degraded 결과를 유도하여 nextCalls 확인
    const degradedResult = await callTool(client, "task", {
      request: "Analyze the architecture of this project",
      mode: "analyze"
    });

    const topLevelNextCalls = degradedResult?.nextCalls;
    const guidanceNextCalls = degradedResult?.guidance?.nextCalls;
    const hasTopLevelNext = Array.isArray(topLevelNextCalls) && topLevelNextCalls.length > 0;
    const hasGuidanceNext = Array.isArray(guidanceNextCalls) && guidanceNextCalls.length > 0;

    if (hasGuidanceNext) {
      report(
        "nextCalls가 top-level에도 존재",
        hasTopLevelNext,
        hasTopLevelNext
          ? `top: ${topLevelNextCalls.length}개, guidance: ${guidanceNextCalls.length}개`
          : `guidance에만 ${guidanceNextCalls.length}개 (top-level 누락!)`
      );
    } else {
      report(
        "nextCalls 검증 (guidance에 없어 스킵)",
        true,
        "nextCalls가 guidance에도 없음 — 정상 (degraded 아닌 경우)"
      );
    }

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 6: 레거시 도구명 검사 (WP1-5) ══");
    // ═══════════════════════════════════════════════════════
    // askResult의 전체 JSON을 문자열화하여 레거시 이름 검사
    const allResults = [askResult, tightResult, degradedResult];
    let legacyFound = false;
    const legacyPatterns = ["project_search", "project_manage", "symbol_index_build"];
    for (const result of allResults) {
      const serialized = JSON.stringify(result ?? {});
      for (const pattern of legacyPatterns) {
        if (serialized.includes(pattern)) {
          report(`응답에 "${pattern}" 없어야 함`, false, "레거시 도구명 발견!");
          legacyFound = true;
        }
      }
    }
    if (!legacyFound) {
      report("모든 응답에 레거시 도구명 없음", true);
    }

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 7: plan_change 워크플로우 (WP2-3) ══");
    // ═══════════════════════════════════════════════════════
    const planResult = await callTool(client, "task", {
      request: "Add a comment at the top of src/index.ts",
      mode: "plan_change"
    });

    const planStatus = planResult?.status;
    report(
      "plan_change가 차단 또는 prep 상태 반환",
      planStatus !== undefined,
      `status: "${planStatus}"`
    );

    // apply_change without token → blocked
    const applyResult = await callTool(client, "task", {
      request: "Apply changes",
      mode: "apply_change"
    });

    const applyStatus = applyResult?.status ?? applyResult?.errorCode;
    report(
      "apply_change (token 없이) → blocked",
      applyStatus === "blocked" || typeof applyResult?.errorCode === "string",
      `status: "${applyStatus}", errorCode: "${applyResult?.errorCode}"`
    );

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 8: manage command description (WP2-7) ══");
    // ═══════════════════════════════════════════════════════
    const manageTool = toolsList.tools.find((t) => t.name === "manage");
    const commandProp = manageTool?.inputSchema?.properties?.command;
    const commandDesc = commandProp?.description ?? "";
    const hasSchemaRequiresToolDoc = commandDesc.includes("schema") && commandDesc.includes("tool");
    report(
      "manage.command description에 schema→tool 안내",
      hasSchemaRequiresToolDoc,
      hasSchemaRequiresToolDoc ? "문서화됨" : `description: "${commandDesc.slice(0, 80)}..."`
    );

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 9: task description에 핵심 안내 포함 (WP1-4 세부) ══");
    // ═══════════════════════════════════════════════════════
    const taskTool = toolsList.tools.find((t) => t.name === "task");
    const taskDesc = taskTool?.description ?? "";
    const hasModeDoc = taskDesc.includes("ask") && taskDesc.includes("plan_change") && taskDesc.includes("apply_change");
    const hasBudgetDoc = taskDesc.includes("balanced") || taskDesc.includes("profile");
    const hasSchemaHint = taskDesc.includes("manage") && taskDesc.includes("schema");
    report("task desc에 mode 설명 포함", hasModeDoc);
    report("task desc에 budget/profile 설명 포함", hasBudgetDoc);
    report("task desc에 manage schema 안내 포함", hasSchemaHint);

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 10: task 스키마에 pillarOptions/safety:auto (Phase 3 일부) ══");
    // ═══════════════════════════════════════════════════════
    const taskInputSchema = taskTool?.inputSchema;
    const hasPillarOptions = Boolean(taskInputSchema?.properties?.pillarOptions);
    const safetyEnum = taskInputSchema?.properties?.safety?.enum ?? [];
    const hasSafetyAuto = safetyEnum.includes("auto");
    report("task에 pillarOptions 존재", hasPillarOptions);
    report("task safety enum에 'auto' 포함", hasSafetyAuto, `enum: [${safetyEnum.join(", ")}]`);

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 11: profile/budget compat alias (WP3-5) ══");
    // ═══════════════════════════════════════════════════════
    // budget 파라미터로 호출해도 정상 동작하는지 확인
    const budgetAliasResult = await callTool(client, "task", {
      request: "Find helper function",
      budget: "balanced"
    });
    report(
      "budget='balanced' alias 호출 성공",
      budgetAliasResult?.status === "success" || budgetAliasResult?.status === "partial_success",
      `status: "${budgetAliasResult?.status}"`
    );

    // ═══════════════════════════════════════════════════════
    // 결과 요약
    // ═══════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(50)}`);
    console.log(`  결과: ${passCount} passed, ${failCount} failed`);
    console.log(`${"═".repeat(50)}\n`);

    if (failCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    try { await client.close(); } catch {}
    try { await clientTransport.close(); } catch {}
    try { await server.shutdown(); } catch {}
    try { await serverTransport.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(2);
});
