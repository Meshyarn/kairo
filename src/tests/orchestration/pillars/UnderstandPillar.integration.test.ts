import { describe, it, expect } from '@jest/globals';
import { InternalToolRegistry } from '../../../orchestration/InternalToolRegistry.js';
import { OrchestrationContext } from '../../../orchestration/OrchestrationContext.js';
import { UnderstandPillar } from '../../../orchestration/pillars/UnderstandPillar.js';
import type { ParsedIntent } from '../../../orchestration/IntentRouter.js';

const buildIntent = (): ParsedIntent => ({
    category: 'understand',
    action: 'analyze',
    targets: ['src/demo.ts'],
    originalIntent: 'Understand demo',
    constraints: {
        goal: 'demo',
        include: {}
    },
    confidence: 1
});

describe('UnderstandPillar integration', () => {
    it('returns a structured response for a basic code target', async () => {
        const registry = new InternalToolRegistry();
        registry.register('project_search', async () => ({
            results: [{ path: 'src/demo.ts' }]
        }) as any);
        registry.register('code_read', async () => 'SKELETON' as any);
        registry.register('file_profile', async () => ({
            metadata: { lineCount: 2 },
            structure: { symbols: [] }
        }) as any);

        const pillar = new UnderstandPillar(registry);
        const result = await pillar.execute(buildIntent(), new OrchestrationContext());

        expect(result.success).toBe(true);
        expect(result.primaryFile).toBe('src/demo.ts');
        expect(result.skeleton).toBe('SKELETON');
    });

    it('emits effectiveOptions and decisionTrace when trace is enabled', async () => {
        const registry = new InternalToolRegistry();
        registry.register('project_search', async () => ({
            results: [{ path: 'src/demo.ts' }]
        }) as any);
        registry.register('code_read', async () => 'SKELETON' as any);
        registry.register('file_profile', async () => ({
            metadata: { lineCount: 2 },
            structure: { symbols: [] }
        }) as any);

        const pillar = new UnderstandPillar(registry);
        const intent = buildIntent();
        intent.constraints.profile = 'deep';
        intent.constraints.trace = true;
        const result = await pillar.execute(intent, new OrchestrationContext());

        expect(result.effectiveOptions?.version).toBe(1);
        expect(result.effectiveOptions?.pillar).toBe('understand');
        expect(result.effectiveOptions?.profile).toBe('deep');
        expect(result.decisionTrace?.version).toBe(1);
        expect(result.decisionTrace?.pillar).toBe('understand');
        expect(result.decisionTrace?.optionResolution?.profile?.resolved).toBe('deep');

        const allowlist = new Set([
            "allocator.plan_created",
            "allocator.section_strategy",
            "allocator.section_omit",
            "allocator.reuse_pack",
            "allocator.reuse_summary"
        ]);
    const allocatorCodes = (result.decisionTrace?.events ?? [])
      .map((event: any) => event?.code)
      .filter((code: any) => typeof code === "string" && code.startsWith("allocator."));
    expect(allocatorCodes.every((code: string) => allowlist.has(code))).toBe(true);

    const adaptiveFlowAllowlist = new Set([
      "adaptive_flow.gate.profile",
      "adaptive_flow.gate.scale",
      "adaptive_flow.rollout.user_missing",
      "adaptive_flow.shadow.noop"
    ]);
    const adaptiveFlowCodes = (result.decisionTrace?.events ?? [])
      .map((event: any) => event?.code)
      .filter((code: any) => typeof code === "string" && code.startsWith("adaptive_flow."));
    expect(adaptiveFlowCodes.every((code: string) => adaptiveFlowAllowlist.has(code))).toBe(true);
  });
});
