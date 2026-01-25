import { describe, it, expect } from '@jest/globals';
import { InternalToolRegistry } from '../../../orchestration/InternalToolRegistry.js';
import { OrchestrationContext } from '../../../orchestration/OrchestrationContext.js';
import { UnderstandPillar } from '../../../orchestration/pillars/UnderstandPillar.js';
import type { ParsedIntent } from '../../../orchestration/IntentRouter.js';
import { FlowArtifactManager } from "../../../orchestration/flow-artifact-manager.js";

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
        registry.register("relationship_analyze", async () => ({ nodes: [], edges: [] }) as any);
        registry.register("hotspot_detect", async () => [] as any);

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

    it("splits call graph into artifact and returns summary fields", async () => {
        const registry = new InternalToolRegistry();
        const flowArtifactManager = new FlowArtifactManager({ defaultTTL: 60_000 });
        registry.setMetadata("flowArtifactManager", flowArtifactManager);
        registry.register('project_search', async () => ({
            results: [{ path: 'src/demo.ts', symbol: { name: "computeTotal" } }]
        }) as any);
        registry.register('code_read', async () => 'SKELETON' as any);
        registry.register('file_profile', async () => ({
            metadata: { lineCount: 2 },
            structure: { symbols: [] }
        }) as any);
        registry.register("relationship_analyze", async () => ({
            nodes: Array.from({ length: 100 }, (_, idx) => ({ id: `n${idx}`, type: "function", path: "src/demo.ts", label: `f${idx}` })),
            edges: Array.from({ length: 200 }, (_, idx) => ({ source: `n${idx % 50}`, target: `n${(idx + 1) % 50}`, relation: "calls" })),
            resolvedTarget: { type: "symbol", path: "src/demo.ts", symbolName: "computeTotal" },
            truncated: true,
            truncatedReason: "cap"
        }) as any);

        const pillar = new UnderstandPillar(registry);
        const intent: ParsedIntent = {
            category: 'understand',
            action: 'analyze',
            targets: ['src/demo.ts'],
            originalIntent: 'Understand computeTotal and its call graph in detail',
            constraints: {
                goal: 'Understand computeTotal and its call graph in detail',
                profile: "deep",
                include: { callGraph: true, dependencies: false, pageRank: false, hotSpots: false },
                limits: { maxTokens: 20000 },
                trace: true,
                sessionId: "new"
            },
            confidence: 1
        };
        const result = await pillar.execute(intent, new OrchestrationContext());
        expect(result.success).toBe(true);
        expect(typeof result.callGraphArtifactId).toBe("string");
        expect(result.callGraphSummary?.truncated).toBe(true);
        expect(Array.isArray(result.callGraphSummary?.topNodes)).toBe(true);
        expect(result.relationships?.calls).toBeUndefined();
        expect(result.callGraph?.meta?.artifactId).toBe(result.callGraphArtifactId);
        expect(result.callGraph?.nodes?.length).toBeLessThanOrEqual(30);
        expect(flowArtifactManager.get(result.callGraphArtifactId)).toBeDefined();

        const traceCodes = (result.decisionTrace?.events ?? []).map((event: any) => event?.code).filter(Boolean);
        expect(traceCodes.includes("budget.response.estimated") || traceCodes.includes("budget.response.enforced")).toBe(true);
    });
});
