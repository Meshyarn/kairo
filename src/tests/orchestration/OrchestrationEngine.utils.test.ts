import { describe, it, expect } from "@jest/globals";
import { OrchestrationEngine } from "../../orchestration/OrchestrationEngine.js";
import { OrchestrationContext } from "../../orchestration/OrchestrationContext.js";
import { CachingStrategy } from "../../orchestration/CachingStrategy.js";

const createEngine = () => {
    return new OrchestrationEngine(
        { parse: () => ({}) } as any,
        { plan: () => ({ steps: [], parallelizableGroups: [] }) } as any,
        { execute: async () => ({}) } as any,
        new CachingStrategy()
    );
};

describe("OrchestrationEngine helpers", () => {
    it("maps args to intent and merges constraints", () => {
        const engine = createEngine() as any;
        const intent = engine.mapArgsToIntent("read", {
            target: "src/app.ts",
            action: "inspect",
            options: { include: { pageRank: true } },
            extra: "value"
        });

        expect(intent.targets).toEqual(["src/app.ts"]);
        expect(intent.action).toBe("inspect");
        expect(intent.constraints.include.pageRank).toBe(true);
        expect(intent.constraints.extra).toBe("value");
    });

    it("resolves params from context state values", () => {
        const engine = createEngine() as any;
        const context = new OrchestrationContext();
        context.setState("target", "src/file.ts");

        const fromString = engine.resolveParams({ mode: "raw" }, "state.target", context);
        expect(fromString.filePath).toBe("src/file.ts");
        expect(fromString.target).toBe("src/file.ts");

        const objectContext = new OrchestrationContext() as OrchestrationContext & {
            resolveTemplate: () => { path: string; extra: string };
        };
        objectContext.resolveTemplate = () => ({ path: "src/object.ts", extra: "ok" });

        const fromObject = engine.resolveParams({ mode: "raw" }, "state.object", objectContext);
        expect(fromObject.filePath).toBe("src/object.ts");
        expect(fromObject.target).toBe("src/object.ts");
        expect(fromObject.extra).toBe("ok");
    });

    it("evaluates conditional expressions against context values", () => {
        const engine = createEngine() as any;
        const context = new OrchestrationContext();
        context.setState("count", 3);
        context.setState("flag", "true");

        expect(engine.evaluateCondition("state.count >= 3", context)).toBe(true);
        expect(engine.evaluateCondition("state.count < 3", context)).toBe(false);
        expect(engine.evaluateCondition("state.flag == \"true\"", context)).toBe(true);
    });

    it("computes page rank and classifies roles", () => {
        const engine = createEngine() as any;
        const ranks = engine.computePageRankFromEdges([
            { source: "a", target: "b" },
            { from: "b", to: "c" }
        ]);

        expect(ranks.get("a")).toBeGreaterThan(0);
        expect(ranks.get("c")).toBeGreaterThan(0);
        expect(engine.classifyRole(0.2, { fanIn: 1, fanOut: 1 })).toBe("core");
        expect(engine.classifyRole(0.05, { fanIn: 6, fanOut: 6 })).toBe("integration");
    });

    it("collects synthesis data from context history", () => {
        const engine = createEngine() as any;
        const context = new OrchestrationContext();
        context.addStep({
            id: "read",
            tool: "code_read",
            args: {},
            output: "skeleton",
            status: "success",
            duration: 1
        });
        context.addStep({
            id: "impact",
            tool: "impact_analyze",
            args: {},
            output: { risk: 1 },
            status: "success",
            duration: 1
        });

        const data = engine.collectSynthesisData(context);
        expect(data.skeletons).toHaveLength(1);
        expect(data.impactPreviews).toHaveLength(1);
    });

    it("identifies cacheable categories", () => {
        const engine = createEngine() as any;
        expect(engine.isCacheable("explore", { target: "a" })).toBe(true);
        expect(engine.isCacheable("change", { target: "a" })).toBe(false);
        expect(engine.isCacheable("write", { target: "a" })).toBe(false);
    });
});
