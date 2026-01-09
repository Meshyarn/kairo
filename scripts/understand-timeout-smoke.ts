// Smoke test for understand timeout regressions.
import { SmartContextServer } from '../src/index.js';

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';

const goal = process.argv[2] ?? 'OrchestrationEngine';
const timeoutMs = Number(process.env.UNDERSTAND_TIMEOUT_MS ?? 5000);

const server = new SmartContextServer(process.cwd());
try {
  const response = await (server as any).handleCallTool('understand', {
    goal,
    limits: { timeoutMs }
  });
  const payloadText = response?.content?.[0]?.text ?? '';
  let payload: any = payloadText;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    // Keep raw payload for debugging if JSON parse fails.
  }
  const summary = {
    goal,
    timeoutMs,
    status: payload?.status ?? 'unknown',
    primaryFile: payload?.primaryFile ?? '',
    degraded: payload?.degraded ?? false
  };
  process.stderr.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await server.shutdown();
  process.exit(0);
}
