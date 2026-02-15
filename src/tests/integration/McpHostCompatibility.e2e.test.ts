import { afterEach, describe, expect, it } from "@jest/globals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import { LATEST_PROTOCOL_VERSION, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type JsonRpcMessage = JSONRPCMessage & {
  id?: number | string;
  method?: string;
  result?: any;
  error?: { code?: number; message?: string };
};

const resolveServerPath = () => path.resolve(process.cwd(), "dist", "index.js");

const createTempRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-mcp-host-"));
  fs.writeFileSync(path.join(root, "README.md"), "# MCP harness\n", "utf-8");
  return root;
};

const buildServerEnv = () => ({
  ...process.env,
  NODE_ENV: "test",
  KAIRO_MODE: "mcp",
  KAIRO_PUBLIC_SURFACE: "compact",
  KAIRO_WARMUP_ENABLED: "false",
  KAIRO_ALLOW_CWD_ROOT: "true"
});

const writeChunk = async (stream: NodeJS.WritableStream, chunk: Buffer) => {
  if (!stream.write(chunk)) {
    await once(stream, "drain");
  }
};

const sendChunked = async (
  stream: NodeJS.WritableStream,
  message: JSONRPCMessage,
  chunkSize = 7
) => {
  const payload = serializeMessage(message);
  for (let i = 0; i < payload.length; i += chunkSize) {
    await writeChunk(stream, Buffer.from(payload.slice(i, i + chunkSize)));
  }
};

const waitForMessage = (
  child: ChildProcessWithoutNullStreams,
  readBuffer: ReadBuffer,
  predicate: (message: JsonRpcMessage) => boolean,
  timeoutMs: number,
  label: string,
  stderrBuffer: string[]
) => {
  return new Promise<JsonRpcMessage>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const stderrText = stderrBuffer.join("");
      reject(new Error(`Timeout waiting for ${label}. stderr=${stderrText}`));
    }, timeoutMs);
    timeout.unref?.();

    const onData = (chunk: Buffer) => {
      readBuffer.append(chunk);
      while (true) {
        const message = readBuffer.readMessage() as JsonRpcMessage | null;
        if (!message) break;
        if (predicate(message)) {
          cleanup();
          resolve(message);
          return;
        }
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`Server exited before ${label}. code=${code} signal=${signal}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.stdout.off("error", onError);
      child.off("close", onClose);
    };

    child.stdout.on("data", onData);
    child.stdout.on("error", onError);
    child.on("close", onClose);
  });
};

const extractSchemaTool = (payload: any): string | undefined => {
  const schema = payload?.schema ?? payload?.result?.schema;
  return schema?.tool;
};

const shutdownChild = async (child: ChildProcessWithoutNullStreams) => {
  const waitForClose = () => once(child, "close");
  const delay = (ms: number) =>
    new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    });

  try {
    child.stdin.end();
  } catch {
    // ignore
  }
  await Promise.race([waitForClose(), delay(2000)]);

  if (child.exitCode == null) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
    await Promise.race([waitForClose(), delay(2000)]);
  }
  if (child.exitCode == null) {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
    await Promise.race([waitForClose(), delay(2000)]);
  }
};

describe("MCP host compatibility harness", () => {
  let tempRoot: string | undefined;
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;

  afterEach(async () => {
    if (client) {
      await client.close();
      client = undefined;
    }
    if (transport) {
      await transport.close();
      transport = undefined;
    }
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it("lists compact tools and calls manage schema", async () => {
    tempRoot = createTempRoot();
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolveServerPath(), "--root", tempRoot],
      env: buildServerEnv(),
      stderr: "pipe"
    });
    client = new Client({ name: "kairo-host-harness", version: "0.1.0" });

    await client.connect(transport);

    const resourcesResult = await (client as any).listResources({});
    expect(Array.isArray(resourcesResult?.resources)).toBe(true);
    const resourceUris = resourcesResult.resources.map((entry: any) => entry.uri);
    expect(resourceUris).toEqual(expect.arrayContaining([
      "kairo://runtime/summary",
      "kairo://config/mcp-policy",
      "kairo://index/snapshot",
      "kairo://tools/public",
      "kairo://docs/agent-playbook",
      "kairo://docs/agent-playbook-compact",
      "kairo://docs/tool-reference",
      "kairo://docs/quick-reference"
    ]));

    const templatesResult = await (client as any).listResourceTemplates({});
    expect(Array.isArray(templatesResult?.resourceTemplates)).toBe(true);
    expect(templatesResult.resourceTemplates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uriTemplate: "kairo://schema/{tool}" })
      ])
    );

    const runtimeSummary = await (client as any).readResource({ uri: "kairo://runtime/summary" });
    const runtimeText = runtimeSummary?.contents?.[0]?.text ?? "";
    const runtimePayload = JSON.parse(runtimeText);
    expect(runtimePayload.rootPath).toBe(tempRoot);
    expect(Array.isArray(runtimePayload.tools)).toBe(true);

    const playbook = await (client as any).readResource({ uri: "kairo://docs/agent-playbook" });
    const playbookText = playbook?.contents?.[0]?.text ?? "";
    expect(playbookText).toContain("Agent Playbook");
    const compactPlaybook = await (client as any).readResource({ uri: "kairo://docs/agent-playbook-compact" });
    const compactPlaybookText = compactPlaybook?.contents?.[0]?.text ?? "";
    expect(compactPlaybookText).toContain("Compact Surface");

    const taskSchema = await (client as any).readResource({ uri: "kairo://schema/task" });
    const schemaText = taskSchema?.contents?.[0]?.text ?? "";
    const schemaPayload = JSON.parse(schemaText);
    expect(schemaPayload.tool).toBe("task");

    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map(tool => tool.name).sort();
    expect(toolNames).toEqual(["manage", "task"]);
    expect(JSON.stringify(toolsResult).length).toBeLessThan(20000);

    const schemaResult = await client.callTool({
      name: "manage",
      arguments: { command: "schema", tool: "task", detail: "summary" }
    });
    const schemaContent = (schemaResult as { content?: Array<{ text?: string }> }).content;
    const payloadText = Array.isArray(schemaContent) ? schemaContent[0]?.text ?? "" : "";
    const payload = JSON.parse(payloadText);
    expect(payload.success).toBe(true);
    expect(extractSchemaTool(payload)).toBe("task");
  });

  it("handles chunked stdio framing within timeouts", async () => {
    const root = createTempRoot();
    const child = spawn(process.execPath, [resolveServerPath(), "--root", root], {
      env: buildServerEnv(),
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stderrBuffer: string[] = [];
    child.stderr.on("data", chunk => {
      stderrBuffer.push(chunk.toString());
    });

    const readBuffer = new ReadBuffer();
    try {
      await once(child, "spawn");
      await sendChunked(child.stdin, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "kairo-host-harness", version: "0.1.0" }
        }
      });

      const initResponse = await waitForMessage(
        child,
        readBuffer,
        message => message.id === 1,
        4000,
        "initialize",
        stderrBuffer
      );
      if (initResponse.error) {
        throw new Error(`Initialize failed: ${initResponse.error.message ?? "unknown"}`);
      }
      expect(initResponse.result?.capabilities?.tools).toBeDefined();

      await sendChunked(child.stdin, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {}
      });

      await sendChunked(child.stdin, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {}
      });

      const listResponse = await waitForMessage(
        child,
        readBuffer,
        message => message.id === 2,
        4000,
        "tools/list",
        stderrBuffer
      );
      if (listResponse.error) {
        throw new Error(`tools/list failed: ${listResponse.error.message ?? "unknown"}`);
      }
      expect(listResponse.result?.tools ?? []).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "task" })])
      );

      await sendChunked(child.stdin, {
        jsonrpc: "2.0",
        id: 4,
        method: "resources/list",
        params: {}
      });

      const resourcesResponse = await waitForMessage(
        child,
        readBuffer,
        message => message.id === 4,
        4000,
        "resources/list",
        stderrBuffer
      );
      if (resourcesResponse.error) {
        throw new Error(`resources/list failed: ${resourcesResponse.error.message ?? "unknown"}`);
      }
      expect(resourcesResponse.result?.resources ?? []).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ uri: "kairo://runtime/summary" }),
          expect.objectContaining({ uri: "kairo://config/mcp-policy" }),
          expect.objectContaining({ uri: "kairo://index/snapshot" }),
          expect.objectContaining({ uri: "kairo://tools/public" }),
          expect.objectContaining({ uri: "kairo://docs/agent-playbook" }),
          expect.objectContaining({ uri: "kairo://docs/agent-playbook-compact" }),
          expect.objectContaining({ uri: "kairo://docs/tool-reference" }),
          expect.objectContaining({ uri: "kairo://docs/quick-reference" })
        ])
      );

      await sendChunked(child.stdin, {
        jsonrpc: "2.0",
        id: 5,
        method: "resources/templates/list",
        params: {}
      });

      const templatesResponse = await waitForMessage(
        child,
        readBuffer,
        message => message.id === 5,
        4000,
        "resources/templates/list",
        stderrBuffer
      );
      if (templatesResponse.error) {
        throw new Error(`resources/templates/list failed: ${templatesResponse.error.message ?? "unknown"}`);
      }
      expect(templatesResponse.result?.resourceTemplates ?? []).toEqual(
        expect.arrayContaining([expect.objectContaining({ uriTemplate: "kairo://schema/{tool}" })])
      );

      await sendChunked(child.stdin, {
        jsonrpc: "2.0",
        id: 6,
        method: "resources/read",
        params: {
          uri: "kairo://runtime/summary"
        }
      });

      const readResponse = await waitForMessage(
        child,
        readBuffer,
        message => message.id === 6,
        4000,
        "resources/read",
        stderrBuffer
      );
      if (readResponse.error) {
        throw new Error(`resources/read failed: ${readResponse.error.message ?? "unknown"}`);
      }
      const summaryText = readResponse.result?.contents?.[0]?.text ?? "";
      const summaryPayload = JSON.parse(summaryText);
      expect(summaryPayload.rootPath).toBe(root);

      await sendChunked(child.stdin, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "manage",
          arguments: { command: "schema", tool: "task", detail: "summary" }
        }
      });

      const callResponse = await waitForMessage(
        child,
        readBuffer,
        message => message.id === 3,
        4000,
        "tools/call",
        stderrBuffer
      );
      if (callResponse.error) {
        throw new Error(`tools/call failed: ${callResponse.error.message ?? "unknown"}`);
      }
      const callText = callResponse.result?.content?.[0]?.text ?? "";
      const callPayload = JSON.parse(callText);
      expect(callPayload.success).toBe(true);
      expect(extractSchemaTool(callPayload)).toBe("task");
    } finally {
      await shutdownChild(child);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
