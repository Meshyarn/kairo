/**
 * ADR-092 전면 개편 검증 스크립트
 *
 * 실제 MCP 서버를 인프로세스로 부팅하여 다음을 검증합니다:
 *  1. tools/list에 kairo_* 5개만 노출, 레거시 도구 미노출
 *  2. 총 공개 매개변수 수 ≤ 15
 *  3. 각 도구 description ≥ 30 단어
 *  4. kairo_search 첫 호출 성공
 *  5. kairo_impact 응답 구조 검증
 *  6. kairo_status 기본 동작
 *  7. kairo_undo history 기본
 *  8. 레거시 도구 호출 시 에러
 *  9. 응답에 legacy 필드(degradedReasons, guidance, nextCalls, contract) 없음
 * 10. kairo_graph 응답 구조
 * 11. 도구 스키마 토큰 효율 (tools/list 크기)
 * 12. kairo_search scope=docs 에러 없음
 *
 * 실행: node scripts/adr-092-verify.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import assert from "node:assert";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const PASS = "\x1b[32m✅ PASS\x1b[0m";
const FAIL = "\x1b[31m❌ FAIL\x1b[0m";

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-adr092-"));
  fs.mkdirSync(path.join(root, "src", "utils"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "README.md"),
    "# ADR-092 Test Project\n\nThis project tests the kairo tool surface.\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(root, "docs", "guide.md"),
    "# Guide\n\nThis is a documentation guide for the project.\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(root, "src", "index.ts"),
    [
      'import { helper } from "./utils/helper";',
      "",
      "export function main(): void {",
      '  console.log("Hello from ADR-092 test");',
      "  helper();",
      "}",
      "",
      "export class SearchEngine {",
      "  query(term: string): string[] {",
      "    return [term];",
      "  }",
      "}",
    ].join("\n"),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(root, "src", "utils", "helper.ts"),
    [
      "export function helper(): void {",
      '  console.log("helper called");',
      "}",
      "",
      "export const VERSION = '0.1.0';",
    ].join("\n"),
    "utf-8",
  );
  return root;
};

const parseToolJson = (toolResult, label) => {
  const text = toolResult?.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`MCP tool response has no text: ${label}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
};

const callTool = async (client, name, args) => {
  const result = await client.callTool({ name, arguments: args });
  return { parsed: parseToolJson(result, name), raw: result };
};

const LEGACY_TOOLS = ["task", "manage", "explore", "understand", "change", "write", "navigate"];
const KAIRO_TOOLS = ["kairo_search", "kairo_impact", "kairo_graph", "kairo_undo", "kairo_status"];

async function main() {
  ensureDist();
  const root = createTestProject();

  process.env.NODE_ENV = "production";
  process.env.KAIRO_MODE = "mcp";
  process.env.KAIRO_PUBLIC_SURFACE = "pillars";
  process.env.KAIRO_WARMUP_ENABLED = "false";
  process.env.KAIRO_METRICS_MODE = "basic";
  process.env.KAIRO_EXPOSE_FILE_TOOLS = "false";
  process.env.KAIRO_EXPOSE_INTERNAL_TOOLS = "false";
  process.env.KAIRO_ALLOW_CWD_ROOT = "true";
  process.env.KAIRO_TEST_USE_NATIVE_CORE = "true";
  process.env.KAIRO_STORAGE_MODE = "memory";
  delete process.env.KAIRO_PRESET;

  const { SmartContextServer } = await import("../dist/server/SmartContextServer.js");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "adr092-verifier", version: "0.1.0" });
  const server = new SmartContextServer(root);

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 1: tools/list — kairo_* 5개만 노출 ══");
    // ═══════════════════════════════════════════════════════
    const toolsList = await client.listTools();
    const toolNames = toolsList.tools.map((t) => t.name);
    const kairoTools = toolNames.filter((n) => n.startsWith("kairo_"));

    report("kairo_* tools count = 5", kairoTools.length === 5, `found: ${kairoTools.join(", ")}`);
    for (const name of KAIRO_TOOLS) {
      report(`${name} present`, toolNames.includes(name));
    }
    for (const name of LEGACY_TOOLS) {
      report(`${name} NOT present`, !toolNames.includes(name));
    }

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 2: 총 매개변수 수 ≤ 15 ══");
    // ═══════════════════════════════════════════════════════
    let totalParams = 0;
    for (const tool of toolsList.tools) {
      if (tool.name.startsWith("kairo_")) {
        totalParams += Object.keys(tool.inputSchema?.properties ?? {}).length;
      }
    }
    report("total params ≤ 15", totalParams <= 15, `total: ${totalParams}`);

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 3: 각 도구 description ≥ 30 단어 ══");
    // ═══════════════════════════════════════════════════════
    for (const tool of toolsList.tools) {
      if (tool.name.startsWith("kairo_")) {
        const wordCount = (tool.description ?? "").split(/\s+/).filter(Boolean).length;
        report(`${tool.name} description (${wordCount}w)`, wordCount >= 30);
      }
    }

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 4: kairo_search 첫 호출 성공 ══");
    // ═══════════════════════════════════════════════════════
    const searchResult = await callTool(client, "kairo_search", { query: "function" });
    report(
      "search returns results array",
      Array.isArray(searchResult.parsed?.results),
      `count: ${searchResult.parsed?.results?.length ?? 0}`,
    );
    report("search not error", !searchResult.raw?.isError);

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 5: kairo_impact 응답 구조 ══");
    // ═══════════════════════════════════════════════════════
    const impactResult = await callTool(client, "kairo_impact", { target: "helper" });
    report("impact has target", "target" in impactResult.parsed);
    report("impact has riskLevel", "riskLevel" in impactResult.parsed);
    report("impact has directRefs", "directRefs" in impactResult.parsed);

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 6: kairo_status 기본 동작 ══");
    // ═══════════════════════════════════════════════════════
    const statusResult = await callTool(client, "kairo_status", {});
    report("status has searchIndex", "searchIndex" in statusResult.parsed);
    report("status searchIndex.available is boolean", typeof statusResult.parsed?.searchIndex?.available === "boolean");

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 7: kairo_undo history 기본 ══");
    // ═══════════════════════════════════════════════════════
    const undoResult = await callTool(client, "kairo_undo", { action: "history" });
    report("undo has undo stack", "undo" in undoResult.parsed);
    report("undo has redo stack", "redo" in undoResult.parsed);

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 8: 레거시 도구 호출 시 에러 ══");
    // ═══════════════════════════════════════════════════════
    for (const legacyName of ["task", "manage"]) {
      try {
        await client.callTool({ name: legacyName, arguments: { request: "test" } });
        report(`${legacyName} rejected`, false, "should have thrown");
      } catch {
        report(`${legacyName} rejected`, true);
      }
    }

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 9: 레거시 응답 필드 없음 ══");
    // ═══════════════════════════════════════════════════════
    const legacyFields = ["degradedReasons", "guidance", "nextCalls", "contract", "sessionId"];
    const searchParsed = searchResult.parsed;
    for (const field of legacyFields) {
      report(`search: no '${field}'`, !(field in searchParsed));
    }

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 10: kairo_graph 응답 구조 ══");
    // ═══════════════════════════════════════════════════════
    const graphResult = await callTool(client, "kairo_graph", { include: ["dependencies"] });
    report("graph has nodes", "nodes" in graphResult.parsed);
    report("graph has edges", "edges" in graphResult.parsed);

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 11: 도구 스키마 토큰 효율 ══");
    // ═══════════════════════════════════════════════════════
    const schemaJson = JSON.stringify(toolsList);
    const estimatedTokens = Math.ceil(schemaJson.length / 4);
    report(
      "schema compact (< 5000 chars)",
      schemaJson.length < 5000,
      `${schemaJson.length} chars (~${estimatedTokens} tokens)`,
    );

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 12: kairo_search scope=docs ══");
    // ═══════════════════════════════════════════════════════
    const docsResult = await callTool(client, "kairo_search", { query: "guide", scope: "docs" });
    report("docs search no error", !docsResult.raw?.isError);
    report("docs search has results array", Array.isArray(docsResult.parsed?.results));

    // ═══════════════════════════════════════════════════════
    console.log("\n══ TEST 13: kairo_status reindex ══");
    // ═══════════════════════════════════════════════════════
    const reindexResult = await callTool(client, "kairo_status", { action: "reindex" });
    report("reindex success=true", reindexResult.parsed?.success === true);
    report("reindex scope=full", reindexResult.parsed?.scope === "full");

  } finally {
    try { await client.close(); } catch { /* ok */ }
    try { clientTransport.close(); } catch { /* ok */ }
    try { await server.shutdown(); } catch { /* ok */ }
    try { serverTransport.close(); } catch { /* ok */ }
    fs.rmSync(root, { recursive: true, force: true });
  }

  // ═══════════════════════════════════════════════════════
  console.log("\n══════════════════════════════════════════");
  console.log(`  결과: ${passCount} passed, ${failCount} failed`);
  console.log("══════════════════════════════════════════\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ Fatal:", err);
  process.exit(2);
});
