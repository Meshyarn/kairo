import type { ParsedIntent } from '../../IntentRouter.js';
import type { OrchestrationContext } from '../../OrchestrationContext.js';
import { metrics } from '../../../utils/MetricsCollector.js';
import { initializeChangeExecution } from './ChangePillarExecutionSetup.js';
import type { ChangePillarExecutionDeps } from './ChangePillarExecutionSetup.js';
import { applyChangeStrategyAndGuardrails } from './ChangePillarExecutionStrategy.js';
import { runChangeTargetingFlow } from './ChangePillarExecutionTargeting.js';
import { executeChangeApplyFlow } from './ChangePillarExecutionApply.js';

export type { ChangePillarExecutionDeps } from './ChangePillarExecutionSetup.js';

export async function executeChangePillar(
  deps: ChangePillarExecutionDeps,
  intent: ParsedIntent,
  context: OrchestrationContext
): Promise<any> {
  const stopTotal = metrics.startTimer('change.total_ms');
  try {
    const initialized = await initializeChangeExecution(deps, intent, context);
    if ('blockedResponse' in initialized) {
      return initialized.blockedResponse;
    }
    const state = initialized.state;

    const strategyResult = await applyChangeStrategyAndGuardrails(state);
    if (strategyResult.blockedResponse) {
      return strategyResult.blockedResponse;
    }

    const targetingResult = await runChangeTargetingFlow(state);
    if (targetingResult.blockedResponse) {
      return targetingResult.blockedResponse;
    }

    return await executeChangeApplyFlow(state);
  } finally {
    stopTotal();
  }
}
