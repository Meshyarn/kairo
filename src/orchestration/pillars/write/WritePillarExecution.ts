import type { ParsedIntent } from '../../IntentRouter.js';
import type { OrchestrationContext } from '../../OrchestrationContext.js';
import { metrics } from '../../../utils/MetricsCollector.js';
import { initializeWriteExecution, type WritePillarExecutionDeps } from './WritePillarExecutionSetup.js';
import { applyWriteGuardrails } from './WritePillarExecutionGuardrails.js';
import { executeWriteFlow } from './WritePillarExecutionFlow.js';

export type { WritePillarExecutionDeps } from './WritePillarExecutionSetup.js';

export async function executeWritePillar(
  deps: WritePillarExecutionDeps,
  intent: ParsedIntent,
  context: OrchestrationContext
): Promise<any> {
  const stopTotal = metrics.startTimer("write.total_ms");
  try {
    const initialized = await initializeWriteExecution(deps, intent, context);
    if ('blockedResponse' in initialized) {
      return initialized.blockedResponse;
    }
    const state = initialized.state;

    const guardrails = await applyWriteGuardrails(state);
    if (guardrails.blockedResponse) {
      return guardrails.blockedResponse;
    }

    return await executeWriteFlow(state);
  } finally {
    stopTotal();
  }
}
