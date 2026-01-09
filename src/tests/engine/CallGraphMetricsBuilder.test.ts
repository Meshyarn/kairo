import { describe, it, expect } from "@jest/globals";
import { CallGraphMetricsBuilder } from "../../engine/CallGraphMetricsBuilder.js";
import type { CallGraphBuilder } from "../../ast/CallGraphBuilder.js";
import type { CallGraphEdge, CallGraphNode } from "../../types.js";

const makeEdge = (from: string, to: string): CallGraphEdge => ({
    fromSymbolId: from,
    toSymbolId: to,
    callType: "direct",
    confidence: "definite",
    line: 1,
    column: 0
});

const makeNode = (
    symbolId: string,
    callers: CallGraphEdge[],
    callees: CallGraphEdge[]
): CallGraphNode => ({
    symbolId,
    symbolName: symbolId,
    filePath: `${symbolId}.ts`,
    symbolType: "function",
    range: { startLine: 0, endLine: 0, startByte: 0, endByte: 1 },
    callers,
    callees
});

describe("CallGraphMetricsBuilder", () => {
    it("builds metrics for reachable nodes and assigns page rank", async () => {
        const edgeAB = makeEdge("A", "B");
        const edgeBC = makeEdge("B", "C");
        const nodeA = makeNode("A", [], [edgeAB]);
        const nodeB = makeNode("B", [edgeAB], [edgeBC]);
        const nodeC = makeNode("C", [edgeBC], []);

        const graph = {
            root: nodeA,
            visitedNodes: { A: nodeA, B: nodeB, C: nodeC },
            truncated: false
        };

        let callCount = 0;
        const callGraphBuilder = {
            analyzeSymbol: async () => {
                callCount += 1;
                return callCount === 1 ? graph : null;
            }
        } as unknown as CallGraphBuilder;

        const builder = new CallGraphMetricsBuilder(callGraphBuilder);
        const metrics = await builder.buildMetrics([
            { symbolName: "A", filePath: "A.ts" },
            { symbolName: "Missing", filePath: "Missing.ts" }
        ]);

        const root = metrics.get("A");
        const middle = metrics.get("B");
        const leaf = metrics.get("C");

        expect(root).toMatchObject({ depth: 0, inDegree: 0, outDegree: 1, isEntryPoint: true });
        expect(middle).toMatchObject({ depth: 1, inDegree: 1, outDegree: 1, isEntryPoint: false });
        expect(leaf).toMatchObject({ depth: 2, inDegree: 1, outDegree: 0, isEntryPoint: false });

        expect(root?.pageRank).toBeGreaterThan(0);
        expect(middle?.pageRank).toBeGreaterThan(0);
        expect(leaf?.pageRank).toBeGreaterThan(0);
    });
});
