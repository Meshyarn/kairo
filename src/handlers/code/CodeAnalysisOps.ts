import { ErrorEnhancer } from "../../errors/ErrorEnhancer.js";
import type { CodeHandlerDeps } from "./CodeHandlerUtils.js";

export const analyzeRelationshipRaw = async (deps: CodeHandlerDeps, args: any) => {
    const { context, resolveRelativePath, resolveAbsolutePath } = deps;
    const target = args?.target;
    const mode = args?.mode as string;
    const direction = (args?.direction ?? "both") as string;
    const maxDepth = typeof args?.maxDepth === "number" ? args.maxDepth : 2;
    const contextPath = args?.contextPath;

    const resolved = await resolveRelationshipTarget(
        deps,
        target,
        args?.targetType ?? "auto",
        contextPath,
        { semanticSymbols: args?.semanticSymbols === true }
    );
    if (resolved.isError) {
        const error = new Error(resolved.message ?? "Unable to resolve target.");
        (error as any).code = resolved.errorCode ?? "InternalError";
        (error as any).details = resolved.details;
        throw error;
    }

    const { filePath, symbolName, resolvedType } = resolved;
    if (!filePath) {
        throw new Error("Unable to resolve target file.");
    }

    if (mode === "impact") {
        const absPath = resolveAbsolutePath(filePath);
        const edits = Array.isArray(args?.edits) ? args.edits : [];
        return context.impactAnalyzer.analyzeImpact(absPath, edits);
    }

    if (mode === "dependencies") {
        await context.dependencyGraph.ensureBuilt();
        const depsList = await context.dependencyGraph.getDependencies(filePath, direction as any);
        const nodes = new Map<string, any>();
        const edges = depsList.map(dep => {
            nodes.set(dep.from, { id: dep.from, type: "file", path: dep.from });
            nodes.set(dep.to, { id: dep.to, type: "file", path: dep.to });
            return { source: dep.from, target: dep.to, relation: dep.type };
        });
        nodes.set(filePath, { id: filePath, type: "file", path: filePath });
        return {
            nodes: Array.from(nodes.values()),
            edges,
            resolvedTarget: { type: resolvedType, path: filePath, symbolName }
        };
    }

    if ((mode === "calls" || mode === "data_flow" || mode === "types") && !symbolName) {
        throw new Error("Symbol name required for this analysis mode.");
    }

    if (mode === "calls") {
        const graph = await context.callGraphBuilder.analyzeSymbol(symbolName!, filePath, direction as any, maxDepth);
        if (!graph) {
            const enhanced = ErrorEnhancer.enhanceSymbolNotFound(symbolName!, context.symbolIndex);
            const error = new Error(`Symbol '${symbolName}' not found.`);
            (error as any).code = "SymbolNotFound";
            (error as any).details = enhanced;
            throw error;
        }
        const nodes = Object.values(graph.visitedNodes).map(node => ({
            id: node.symbolId,
            type: node.symbolType,
            path: node.filePath,
            label: node.symbolName
        }));
        const edges = Object.values(graph.visitedNodes).flatMap(node =>
            node.callees.map(edge => ({ source: edge.fromSymbolId, target: edge.toSymbolId, relation: edge.callType }))
                .concat(node.callers.map(edge => ({ source: edge.fromSymbolId, target: edge.toSymbolId, relation: edge.callType })))
        );
        return {
            nodes,
            edges,
            resolvedTarget: { type: "symbol", path: filePath, symbolName },
            truncated: graph.truncated,
            ...(graph.truncatedReason ? { truncatedReason: graph.truncatedReason } : {})
        };
    }

    if (mode === "data_flow") {
        const flow = await context.dataFlowTracer.traceVariable(symbolName!, filePath, args?.fromLine, args?.maxSteps ?? 10);
        if (!flow) {
            throw new Error("No data flow information available.");
        }
        const nodes = Object.values(flow.steps).map(step => ({
            id: step.id,
            type: step.stepType,
            path: step.filePath,
            label: step.textSnippet
        }));
        const edges = flow.edges.map(edge => ({
            source: edge.fromStepId,
            target: edge.toStepId,
            relation: edge.relation
        }));
        return {
            nodes,
            edges,
            resolvedTarget: { type: "variable", path: filePath, symbolName }
        };
    }

    if (mode === "types") {
        const graph = await context.typeDependencyTracker.analyzeType(symbolName!, filePath, direction as any, maxDepth);
        if (!graph) {
            throw new Error("Type dependency graph unavailable.");
        }
        const nodes = Object.values(graph.visitedNodes).map(node => ({
            id: node.symbolId,
            type: node.symbolType,
            path: node.filePath,
            label: node.symbolName
        }));
        const edges = Object.values(graph.visitedNodes).flatMap(node =>
            node.dependencies.map(edge => ({ source: edge.fromSymbolId, target: edge.toSymbolId, relation: edge.relationKind }))
                .concat(node.parents.map(edge => ({ source: edge.fromSymbolId, target: edge.toSymbolId, relation: edge.relationKind })))
        );
        return {
            nodes,
            edges,
            resolvedTarget: { type: "symbol", path: filePath, symbolName }
        };
    }

    throw new Error(`Unknown relationship_analyze mode: ${mode}`);
};

const resolveRelationshipTarget = async (
    deps: CodeHandlerDeps,
    target: string,
    targetType: string,
    contextPath?: string,
    options: { semanticSymbols?: boolean } = {}
): Promise<{ isError?: boolean; errorCode?: string; message?: string; details?: any; filePath?: string; symbolName?: string; resolvedType: "file" | "symbol" | "variable" }> => {
    const { context, resolveRelativePath } = deps;
    if (!target) {
        return { isError: true, errorCode: "MissingParameter", message: "Missing required parameter: target", resolvedType: "file" };
    }
    const inferredType = targetType === "auto"
        ? (/[\\/]/.test(target) || /\.[a-z0-9]+$/i.test(target) ? "file" : "symbol")
        : targetType;

    if (inferredType === "file") {
        const filePath = resolveRelativePath(target);
        return { filePath, resolvedType: "file" };
    }

    const symbolName = target;
    let filePath: string | undefined;
    if (contextPath) {
        filePath = resolveRelativePath(contextPath);
    } else {
        const matches = await context.symbolIndex.search(symbolName);
        if (matches.length > 0) {
            filePath = matches[0].filePath;
        }
    }
    if (!filePath && options.semanticSymbols && context.symbolEmbeddingIndex) {
        const semantic = await context.symbolEmbeddingIndex.searchSymbolsWithDiagnostics(symbolName, { topK: 3 });
        if (!semantic.degraded && semantic.results.length > 0) {
            const best = semantic.results[0];
            filePath = resolveRelativePath(best.symbol.filePath);
            return { filePath, symbolName: best.symbol.name, resolvedType: "symbol" };
        }
        if (semantic.degraded) {
            const enhanced = ErrorEnhancer.enhanceSymbolNotFound(symbolName, context.symbolIndex);
            return {
                isError: true,
                errorCode: "SymbolNotFound",
                message: `Symbol '${symbolName}' not found.`,
                details: { ...enhanced, semanticSearch: { degraded: true, reason: semantic.reason } },
                resolvedType: "symbol"
            };
        }
    }
    if (!filePath) {
        const enhanced = ErrorEnhancer.enhanceSymbolNotFound(symbolName, context.symbolIndex);
        return { isError: true, errorCode: "SymbolNotFound", message: `Symbol '${symbolName}' not found.`, details: enhanced, resolvedType: "symbol" };
    }
    return { filePath, symbolName, resolvedType: "symbol" };
};
