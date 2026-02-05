import * as path from "path";
import { SymbolIndex } from "./SymbolIndex.js";
import { ModuleResolver } from "./ModuleResolver.js";
import {
    CallGraphEdge,
    CallGraphNode,
    CallGraphResult,
    CallSiteInfo,
    DefinitionSymbol,
    SymbolInfo
} from "../types.js";
import type {
    CallGraphBudget,
    CallGraphDirection,
    DefinitionLocation,
    FileSymbolContext,
    GlobalIndexData
} from "./CallGraphBuilderTypes.js";
import { getFileContext, resolveCallTargets } from "./CallGraphBuilderContext.js";
import { buildGlobalIndex } from "./CallGraphBuilderIndex.js";
import { populateDownstream, populateUpstream } from "./CallGraphBuilderTraversal.js";

/**
 * CallGraphBuilder is responsible for assembling symbol-level call relationships.
 * The current scaffolding wires up definition lookup and establishes the root node structure.
 * Detailed traversal logic will be layered on in subsequent iterations.
 */
export class CallGraphBuilder {
    private readonly fileContextCache = new Map<string, FileSymbolContext>();
    private globalIndexData: GlobalIndexData | null = null;
    private readonly maxCallGraphNodes: number | undefined = this.resolveCap("KAIRO_CALLGRAPH_MAX_NODES");
    private readonly maxCallGraphEdges: number | undefined = this.resolveCap("KAIRO_CALLGRAPH_MAX_EDGES");

    constructor(
        private readonly rootPath: string,
        private readonly symbolIndex: SymbolIndex,
        private readonly moduleResolver: ModuleResolver
    ) {}

    public async analyzeSymbol(
        symbolName: string,
        filePath: string,
        direction: CallGraphDirection = "both",
        maxDepth: number = 3
    ): Promise<CallGraphResult | null> {
        const absPath = path.isAbsolute(filePath) ? filePath : path.join(this.rootPath, filePath);
        const definition = await this.findDefinition(symbolName, absPath);
        if (!definition) {
            return null;
        }

        const normalizedPath = await this.ensureRelativePath(absPath);
        if (!normalizedPath) {
            return null;
        }

        maxDepth = Math.max(0, Math.floor(maxDepth));
        const symbolId = this.makeSymbolId(normalizedPath, symbolName);
        const root: CallGraphNode = {
            symbolId,
            symbolName,
            filePath: normalizedPath,
            symbolType: definition.type,
            range: definition.range,
            callers: [],
            callees: []
        };

        const visitedNodes: Record<string, CallGraphNode> = { [symbolId]: root };
        const definitionCache = new Map<string, DefinitionLocation>();
        definitionCache.set(symbolId, { definition, absPath, relativePath: normalizedPath });
        const budget = this.createBudgetTracker();
        if (budget) {
            budget.nodeCount = 1;
        }

        const queue: Array<{ symbolId: string; depth: number }> = [];
        const depthBySymbol = new Map<string, number>();
        const processed = new Set<string>();
        depthBySymbol.set(symbolId, 0);
        queue.push({ symbolId, depth: 0 });

        const needsUpstream = direction === "upstream" || direction === "both";
        const needsDownstream = direction === "downstream" || direction === "both";
        let truncated = false;
        let truncatedReason: "cap" | "depth" | "unknown" | undefined;

        const ensureGlobalData = async (): Promise<GlobalIndexData> => {
            if (!this.globalIndexData) {
                this.globalIndexData = await this.buildGlobalIndex();
            }
            return this.globalIndexData;
        };

        while (queue.length > 0) {
            if (budget?.exhausted) {
                truncated = true;
                truncatedReason = truncatedReason ?? "cap";
                break;
            }
            const { symbolId: currentId, depth } = queue.shift()!;
            const recordedDepth = depthBySymbol.get(currentId);
            if (recordedDepth !== undefined && depth > recordedDepth) {
                continue;
            }
            if (processed.has(currentId)) {
                continue;
            }
            processed.add(currentId);

            const location = definitionCache.get(currentId);
            const node = visitedNodes[currentId];
            if (!location || !node) {
                continue;
            }

            if (needsDownstream) {
                const downstream = await populateDownstream(this.buildTraversalContext(), {
                    node,
                    location,
                    depth,
                    maxDepth,
                    visitedNodes,
                    definitionCache,
                    queue,
                    depthBySymbol,
                    processed,
                    budget,
                    getGlobalDefinitions: async () => (await ensureGlobalData()).definitionsByName
                });
                if (downstream.truncated) {
                    truncated = true;
                    if (downstream.truncatedReason) {
                        truncatedReason = truncatedReason ?? downstream.truncatedReason;
                    }
                }
            }

            if (needsUpstream) {
                const upstream = await populateUpstream(this.buildTraversalContext(), {
                    node,
                    location,
                    depth,
                    maxDepth,
                    visitedNodes,
                    definitionCache,
                    queue,
                    depthBySymbol,
                    processed,
                    budget,
                    getGlobalData: ensureGlobalData
                });
                if (upstream.truncated) {
                    truncated = true;
                    if (upstream.truncatedReason) {
                        truncatedReason = truncatedReason ?? upstream.truncatedReason;
                    }
                }
            }
        }

        return {
            root,
            visitedNodes,
            truncated: truncated || budget?.truncated === true,
            truncatedReason: truncatedReason ?? (budget?.truncated ? "cap" : undefined)
        };
    }

    private async findDefinition(symbolName: string, absPath: string): Promise<DefinitionSymbol | undefined> {
        const symbols = await this.symbolIndex.getSymbolsForFile(absPath);
        return symbols.find((symbol): symbol is DefinitionSymbol => this.isDefinition(symbol) && symbol.name === symbolName);
    }

    private isDefinition(symbol: SymbolInfo): symbol is DefinitionSymbol {
        return symbol.type !== "import" && symbol.type !== "export";
    }

    private makeSymbolId(filePath: string, symbolName: string): string {
        return `${filePath}::${symbolName}`;
    }

    private normalizeRelativePath(absPath: string): string {
        const relative = path.relative(this.rootPath, absPath);
        return relative || path.basename(absPath);
    }

    private async ensureRelativePath(absPath: string): Promise<string | null> {
        if (!absPath) return null;
        return this.normalizeRelativePath(absPath);
    }

    private getOrCreateNode(
        symbolId: string,
        definition: DefinitionSymbol,
        relativePath: string,
        visitedNodes: Record<string, CallGraphNode>
    ): CallGraphNode {
        const existing = visitedNodes[symbolId];
        if (existing) {
            return existing;
        }
        const node: CallGraphNode = {
            symbolId,
            symbolName: definition.name,
            filePath: relativePath,
            symbolType: definition.type,
            range: definition.range,
            callers: [],
            callees: []
        };
        visitedNodes[symbolId] = node;
        return node;
    }

    private enqueueNode(
        symbolId: string,
        depth: number,
        maxDepth: number,
        queue: Array<{ symbolId: string; depth: number }>,
        depthBySymbol: Map<string, number>,
        processed: Set<string>
    ) {
        if (depth > maxDepth) {
            return;
        }
        const recordedDepth = depthBySymbol.get(symbolId);
        if (recordedDepth !== undefined && recordedDepth <= depth) {
            return;
        }
        if (processed.has(symbolId)) {
            return;
        }
        depthBySymbol.set(symbolId, depth);
        queue.push({ symbolId, depth });
    }

    private addEdge(
        fromNode: CallGraphNode,
        toNode: CallGraphNode,
        edge: Omit<CallGraphEdge, "fromSymbolId" | "toSymbolId">,
        budget?: CallGraphBudget
    ): boolean {
        if (budget?.exhausted) {
            budget.truncated = true;
            return false;
        }
        const newEdge: CallGraphEdge = {
            fromSymbolId: fromNode.symbolId,
            toSymbolId: toNode.symbolId,
            ...edge
        };

        if (!fromNode.callees.some(existing => this.sameEdge(existing, newEdge))) {
            if (budget?.maxEdges && budget.edgeCount >= budget.maxEdges) {
                budget.truncated = true;
                budget.exhausted = true;
                return false;
            }
            fromNode.callees.push(newEdge);
            if (budget) {
                budget.edgeCount += 1;
                if (budget.maxEdges && budget.edgeCount >= budget.maxEdges) {
                    budget.truncated = true;
                    budget.exhausted = true;
                }
            }
        }
        if (!toNode.callers.some(existing => this.sameEdge(existing, newEdge))) {
            toNode.callers.push(newEdge);
        }
        return true;
    }

    private sameEdge(left: CallGraphEdge, right: CallGraphEdge): boolean {
        return (
            left.fromSymbolId === right.fromSymbolId &&
            left.toSymbolId === right.toSymbolId &&
            left.line === right.line &&
            left.column === right.column &&
            left.callType === right.callType
        );
    }

    private buildTraversalContext() {
        return {
            resolveCallTargets: (call: CallSiteInfo, context: FileSymbolContext, provider?: () => Promise<Map<string, DefinitionLocation[]>>) =>
                this.resolveCallTargets(call, context, provider),
            getFileContext: (absPath: string) => this.getFileContext(absPath),
            makeSymbolId: (filePath: string, symbolName: string) => this.makeSymbolId(filePath, symbolName),
            getOrCreateNodeWithBudget: (
                symbolId: string,
                definition: DefinitionSymbol,
                relativePath: string,
                visitedNodes: Record<string, CallGraphNode>,
                budget?: CallGraphBudget
            ) => this.getOrCreateNodeWithBudget(symbolId, definition, relativePath, visitedNodes, budget),
            addEdge: (
                fromNode: CallGraphNode,
                toNode: CallGraphNode,
                edge: Omit<CallGraphEdge, "fromSymbolId" | "toSymbolId">,
                budget?: CallGraphBudget
            ) => this.addEdge(fromNode, toNode, edge, budget),
            enqueueNode: (
                symbolId: string,
                depth: number,
                maxDepth: number,
                queue: Array<{ symbolId: string; depth: number }>,
                depthBySymbol: Map<string, number>,
                processed: Set<string>
            ) => this.enqueueNode(symbolId, depth, maxDepth, queue, depthBySymbol, processed)
        };
    }

    private async resolveCallTargets(
        call: CallSiteInfo,
        context: FileSymbolContext,
        definitionRegistryProvider?: () => Promise<Map<string, DefinitionLocation[]>>
    ) {
        return resolveCallTargets({
            call,
            context,
            moduleResolver: this.moduleResolver,
            getFileContext: (absPath: string) => this.getFileContext(absPath),
            makeSymbolId: (filePath: string, symbolName: string) => this.makeSymbolId(filePath, symbolName),
            definitionRegistryProvider
        });
    }

    private async getFileContext(absPath: string): Promise<FileSymbolContext | null> {
        return getFileContext({
            absPath,
            symbolIndex: this.symbolIndex,
            fileContextCache: this.fileContextCache,
            normalizeRelativePath: (entry) => this.normalizeRelativePath(entry)
        });
    }

    private getFileContextCacheKey(absPath: string): string {
        return path.normalize(absPath);
    }

    private async buildGlobalIndex(): Promise<GlobalIndexData> {
        return buildGlobalIndex({
            rootPath: this.rootPath,
            symbolIndex: this.symbolIndex,
            fileContextCache: this.fileContextCache,
            normalizeRelativePath: (entry) => this.normalizeRelativePath(entry)
        });
    }

    public clearCaches(): void {
        this.fileContextCache.clear();
        this.globalIndexData = null;
    }

    public invalidateFile(absPath: string): void {
        const key = this.getFileContextCacheKey(absPath);
        this.fileContextCache.delete(key);
        this.globalIndexData = null;
    }

    public invalidateDirectory(absPath: string): void {
        const normalized = this.getFileContextCacheKey(absPath);
        for (const key of Array.from(this.fileContextCache.keys())) {
            if (key === normalized || key.startsWith(`${normalized}${path.sep}`)) {
                this.fileContextCache.delete(key);
            }
        }
        this.globalIndexData = null;
    }

    private resolveCap(envKey: string): number | undefined {
        const raw = process.env[envKey];
        if (!raw) return undefined;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
        return Math.floor(parsed);
    }

    private createBudgetTracker(): CallGraphBudget | undefined {
        if (!this.maxCallGraphNodes && !this.maxCallGraphEdges) {
            return undefined;
        }
        return {
            maxNodes: this.maxCallGraphNodes,
            maxEdges: this.maxCallGraphEdges,
            nodeCount: 0,
            edgeCount: 0,
            truncated: false,
            exhausted: false
        };
    }

    private getOrCreateNodeWithBudget(
        symbolId: string,
        definition: DefinitionSymbol,
        relativePath: string,
        visitedNodes: Record<string, CallGraphNode>,
        budget?: CallGraphBudget
    ): CallGraphNode | null {
        const existing = visitedNodes[symbolId];
        if (existing) {
            return existing;
        }
        if (budget?.maxNodes && budget.nodeCount >= budget.maxNodes) {
            budget.truncated = true;
            budget.exhausted = true;
            return null;
        }
        const node = this.getOrCreateNode(symbolId, definition, relativePath, visitedNodes);
        if (budget) {
            budget.nodeCount += 1;
            if (budget.maxNodes && budget.nodeCount >= budget.maxNodes) {
                budget.truncated = true;
            }
        }
        return node;
    }
}
