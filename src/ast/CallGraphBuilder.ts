import * as path from "path";
import { SymbolIndex } from "./SymbolIndex.js";
import { ModuleResolver } from "./ModuleResolver.js";
import {
    CallGraphEdge,
    CallGraphNode,
    CallGraphResult,
    CallConfidence,
    CallSiteInfo,
    DefinitionSymbol,
    ImportSymbol,
    SymbolInfo
} from "../types.js";

export type CallGraphDirection = "upstream" | "downstream" | "both";

interface DefinitionLocation {
    definition: DefinitionSymbol;
    absPath: string;
    relativePath: string;
}

interface FileSymbolContext {
    absPath: string;
    relativePath: string;
    definitions: DefinitionSymbol[];
    imports: ImportSymbol[];
    importBindings?: ImportBinding[];
}

interface ImportBinding {
    alias: string;
    source: string;
    importKind: ImportSymbol["importKind"];
    importedName?: string;
    isTypeOnly?: boolean;
}

interface ResolvedCallTarget extends DefinitionLocation {
    confidence: CallConfidence;
}

interface GlobalCallSite {
    context: FileSymbolContext;
    definition: DefinitionSymbol;
    call: CallSiteInfo;
}

interface GlobalIndexData {
    definitionsByName: Map<string, DefinitionLocation[]>;
    callSitesByName: Map<string, GlobalCallSite[]>;
}

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
                const downstream = await this.populateDownstream({
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
                const upstream = await this.populateUpstream({
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

    private async populateDownstream(params: {
        node: CallGraphNode;
        location: DefinitionLocation;
        depth: number;
        maxDepth: number;
        visitedNodes: Record<string, CallGraphNode>;
        definitionCache: Map<string, DefinitionLocation>;
        queue: Array<{ symbolId: string; depth: number }>;
        depthBySymbol: Map<string, number>;
        processed: Set<string>;
        budget?: CallGraphBudget;
        getGlobalDefinitions?: () => Promise<Map<string, DefinitionLocation[]>>;
    }): Promise<{ truncated: boolean; truncatedReason?: "cap" | "depth" | "unknown" }> {
        const { node, location, depth, maxDepth, visitedNodes, definitionCache, queue, depthBySymbol, processed, budget } = params;
        const definition = location.definition;
        if (!definition.calls || definition.calls.length === 0) {
            return { truncated: false };
        }

        if (depth >= maxDepth) {
            return { truncated: true, truncatedReason: "depth" };
        }

        const context = await this.getFileContext(location.absPath);
        if (!context) {
            return { truncated: true, truncatedReason: "unknown" };
        }

        let truncated = false;
        let truncatedReason: "cap" | "depth" | "unknown" | undefined;
        for (const call of definition.calls) {
            if (budget?.exhausted) {
                truncated = true;
                truncatedReason = truncatedReason ?? "cap";
                break;
            }
            const targets = await this.resolveCallTargets(call, context, params.getGlobalDefinitions);
            if (targets.length === 0) {
                truncated = true;
                truncatedReason = truncatedReason ?? "unknown";
                continue;
            }

            for (const target of targets) {
                if (budget?.exhausted) {
                    truncated = true;
                    truncatedReason = truncatedReason ?? "cap";
                    break;
                }
                const nextDepth = depth + 1;
                if (nextDepth > maxDepth) {
                    truncated = true;
                    truncatedReason = truncatedReason ?? "depth";
                    continue;
                }

                const symbolId = this.makeSymbolId(target.relativePath, target.definition.name);
                const calleeNode = this.getOrCreateNodeWithBudget(symbolId, target.definition, target.relativePath, visitedNodes, budget);
                if (!calleeNode) {
                    truncated = true;
                    truncatedReason = truncatedReason ?? "cap";
                    continue;
                }
                if (!definitionCache.has(symbolId)) {
                    definitionCache.set(symbolId, target);
                }

                const added = this.addEdge(node, calleeNode, {
                    callType: call.callType,
                    confidence: target.confidence,
                    line: call.line,
                    column: call.column
                }, budget);
                if (!added && budget?.exhausted) {
                    truncated = true;
                    truncatedReason = truncatedReason ?? "cap";
                    break;
                }

                this.enqueueNode(symbolId, nextDepth, maxDepth, queue, depthBySymbol, processed);
            }
        }

        return { truncated, ...(truncatedReason ? { truncatedReason } : {}) };
    }

    private async populateUpstream(params: {
        node: CallGraphNode;
        location: DefinitionLocation;
        depth: number;
        maxDepth: number;
        visitedNodes: Record<string, CallGraphNode>;
        definitionCache: Map<string, DefinitionLocation>;
        queue: Array<{ symbolId: string; depth: number }>;
        depthBySymbol: Map<string, number>;
        processed: Set<string>;
        budget?: CallGraphBudget;
        getGlobalData: () => Promise<GlobalIndexData>;
    }): Promise<{ truncated: boolean; truncatedReason?: "cap" | "depth" | "unknown" }> {
        const { node, location, depth, maxDepth, visitedNodes, definitionCache, queue, depthBySymbol, processed, budget } = params;
        const globalData = await params.getGlobalData();
        const candidates = globalData.callSitesByName.get(location.definition.name);
        if (!candidates || candidates.length === 0) {
            return { truncated: false };
        }

        if (depth >= maxDepth) {
            return { truncated: true, truncatedReason: "depth" };
        }

        let truncated = false;
        let truncatedReason: "cap" | "depth" | "unknown" | undefined;
        for (const site of candidates) {
            if (budget?.exhausted) {
                truncated = true;
                truncatedReason = truncatedReason ?? "cap";
                break;
            }
            const resolvedTargets = await this.resolveCallTargets(site.call, site.context, async () => globalData.definitionsByName);
            const match = resolvedTargets.find(target =>
                target.relativePath === location.relativePath &&
                target.definition.name === location.definition.name
            );
            if (!match) {
                continue;
            }

            const nextDepth = depth + 1;
            if (nextDepth > maxDepth) {
                truncated = true;
                truncatedReason = truncatedReason ?? "depth";
                continue;
            }

            const callerId = this.makeSymbolId(site.context.relativePath, site.definition.name);
            const callerNode = this.getOrCreateNodeWithBudget(callerId, site.definition, site.context.relativePath, visitedNodes, budget);
            if (!callerNode) {
                truncated = true;
                truncatedReason = truncatedReason ?? "cap";
                continue;
            }
            if (!definitionCache.has(callerId)) {
                definitionCache.set(callerId, {
                    definition: site.definition,
                    absPath: site.context.absPath,
                    relativePath: site.context.relativePath
                });
            }

            const added = this.addEdge(callerNode, node, {
                callType: site.call.callType,
                confidence: match.confidence,
                line: site.call.line,
                column: site.call.column
            }, budget);
            if (!added && budget?.exhausted) {
                truncated = true;
                truncatedReason = truncatedReason ?? "cap";
                break;
            }

            this.enqueueNode(callerId, nextDepth, maxDepth, queue, depthBySymbol, processed);
        }

        return { truncated, ...(truncatedReason ? { truncatedReason } : {}) };
    }

    private async resolveCallTargets(
        call: CallSiteInfo,
        context: FileSymbolContext,
        definitionRegistryProvider?: () => Promise<Map<string, DefinitionLocation[]>>
    ): Promise<ResolvedCallTarget[]> {
        const results: ResolvedCallTarget[] = [];
        const seen = new Set<string>();

        const pushTarget = (target: DefinitionLocation, confidence: CallConfidence) => {
            const symbolId = this.makeSymbolId(target.relativePath, target.definition.name);
            if (seen.has(symbolId)) {
                return;
            }
            seen.add(symbolId);
            results.push({ ...target, confidence });
        };

        const localMatches = this.findLocalMatches(call, context);
        for (const match of localMatches) {
            pushTarget(match, "definite");
        }

        const importMatches = await this.findImportMatches(call, context);
        for (const match of importMatches) {
            pushTarget(match.location, match.confidence);
        }

        if (results.length === 0 && definitionRegistryProvider) {
            const registry = await definitionRegistryProvider();
            const fallback = registry.get(call.calleeName) || [];
            for (const location of fallback) {
                pushTarget(location, "inferred");
            }
        }

        return results;
    }

    private findLocalMatches(call: CallSiteInfo, context: FileSymbolContext): DefinitionLocation[] {
        if (call.calleeObject && !["this", "super", "self"].includes(call.calleeObject)) {
            return [];
        }
        const matches = context.definitions.filter(def => def.name === call.calleeName);
        return matches.map(def => ({
            definition: def,
            absPath: context.absPath,
            relativePath: context.relativePath
        }));
    }

    private async findImportMatches(call: CallSiteInfo, context: FileSymbolContext): Promise<Array<{ location: DefinitionLocation; confidence: CallConfidence }>> {
        const bindings = this.getImportBindings(context);
        const matches: Array<{ location: DefinitionLocation; confidence: CallConfidence }> = [];

        const relevant = bindings.filter(binding => {
            if (binding.isTypeOnly) return false;
            if (call.calleeObject) {
                return binding.alias === call.calleeObject;
            }
            return binding.alias === call.calleeName;
        });

        for (const binding of relevant) {
            const targetName = this.getTargetNameForBinding(binding, call);
            const locations = await this.resolveBinding(binding, targetName, context);
            const confidence: CallConfidence = binding.importKind === "named" ? "definite" : "possible";
            for (const location of locations) {
                matches.push({ location, confidence });
            }
        }

        return matches;
    }

    private getTargetNameForBinding(binding: ImportBinding, call: CallSiteInfo): string | undefined {
        if (binding.importKind === "named") {
            return binding.importedName || call.calleeName;
        }
        if (binding.importKind === "namespace") {
            return call.calleeName;
        }
        if (binding.importKind === "default") {
            return binding.importedName || call.calleeName;
        }
        return undefined;
    }

    private async resolveBinding(binding: ImportBinding, targetName: string | undefined, context: FileSymbolContext): Promise<DefinitionLocation[]> {
        const resolvedPath = this.moduleResolver.resolve(context.absPath, binding.source);
        if (!resolvedPath) {
            return [];
        }
        const targetContext = await this.getFileContext(resolvedPath);
        if (!targetContext) {
            return [];
        }

        const definitions = this.pickDefinitionsForBinding(binding, targetName, targetContext);
        return definitions.map(def => ({
            definition: def,
            absPath: resolvedPath,
            relativePath: targetContext.relativePath
        }));
    }

    private pickDefinitionsForBinding(binding: ImportBinding, targetName: string | undefined, context: FileSymbolContext): DefinitionSymbol[] {
        if (binding.importKind === "named") {
            return context.definitions.filter(def => def.name === targetName);
        }

        if (binding.importKind === "namespace") {
            return context.definitions.filter(def => def.name === targetName);
        }

        if (binding.importKind === "default") {
            let matches = context.definitions.filter(def => def.modifiers?.includes("default"));
            if (matches.length === 0 && targetName) {
                matches = context.definitions.filter(def => def.name === targetName);
            }
            if (matches.length === 0 && context.definitions.length > 0) {
                matches = [context.definitions[0]];
            }
            return matches;
        }

        return [];
    }

    private getImportBindings(context: FileSymbolContext): ImportBinding[] {
        if (context.importBindings) {
            return context.importBindings;
        }

        const bindings: ImportBinding[] = [];
        for (const symbol of context.imports) {
            if (symbol.importKind === "default") {
                const alias = symbol.alias || symbol.name;
                if (alias) {
                    bindings.push({
                        alias,
                        source: symbol.source,
                        importKind: symbol.importKind,
                        importedName: alias,
                        isTypeOnly: symbol.isTypeOnly
                    });
                }
            } else if (symbol.importKind === "namespace") {
                const alias = symbol.alias || symbol.name;
                if (alias) {
                    bindings.push({
                        alias,
                        source: symbol.source,
                        importKind: symbol.importKind,
                        isTypeOnly: symbol.isTypeOnly
                    });
                }
            } else if (symbol.importKind === "named" && symbol.imports) {
                for (const spec of symbol.imports) {
                    const alias = spec.alias || spec.name;
                    bindings.push({
                        alias,
                        source: symbol.source,
                        importKind: symbol.importKind,
                        importedName: spec.name,
                        isTypeOnly: symbol.isTypeOnly
                    });
                }
            }
        }

        context.importBindings = bindings;
        return bindings;
    }

    private async getFileContext(absPath: string): Promise<FileSymbolContext | null> {
        const cacheKey = this.getFileContextCacheKey(absPath);
        if (this.fileContextCache.has(cacheKey)) {
            return this.fileContextCache.get(cacheKey)!;
        }

        try {
            const symbols = await this.symbolIndex.getSymbolsForFile(absPath);
            return this.buildFileContext(absPath, symbols);
        } catch {
            return null;
        }
    }

    private buildFileContext(absPath: string, symbols: SymbolInfo[]): FileSymbolContext {
        const relativePath = this.normalizeRelativePath(absPath);
        const definitions: DefinitionSymbol[] = [];
        const imports: ImportSymbol[] = [];

        for (const symbol of symbols) {
            if (this.isDefinition(symbol)) {
                definitions.push(symbol);
            } else if (this.isImportSymbol(symbol)) {
                imports.push(symbol);
            }
        }

        const context: FileSymbolContext = { absPath, relativePath, definitions, imports };
        const cacheKey = this.getFileContextCacheKey(absPath);
        this.fileContextCache.set(cacheKey, context);
        return context;
    }

    private getFileContextCacheKey(absPath: string): string {
        return path.normalize(absPath);
    }

    private isImportSymbol(symbol: SymbolInfo): symbol is ImportSymbol {
        return symbol.type === "import";
    }

    private async buildGlobalIndex(): Promise<GlobalIndexData> {
        const entries = await this.symbolIndex.getAllSymbols();
        const definitionsByName = new Map<string, DefinitionLocation[]>();
        const callSitesByName = new Map<string, GlobalCallSite[]>();

        for (const [relativePath, symbols] of entries.entries()) {
            const absPath = path.isAbsolute(relativePath) ? relativePath : path.join(this.rootPath, relativePath);
            const context = this.buildFileContext(absPath, symbols);

            for (const definition of context.definitions) {
                const list = definitionsByName.get(definition.name) || [];
                list.push({ definition, absPath, relativePath: context.relativePath });
                definitionsByName.set(definition.name, list);

                if (!definition.calls) continue;
                for (const call of definition.calls) {
                    const bucket = callSitesByName.get(call.calleeName) || [];
                    bucket.push({ context, definition, call });
                    callSitesByName.set(call.calleeName, bucket);
                }
            }
        }

        return { definitionsByName, callSitesByName };
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

type CallGraphBudget = {
    maxNodes?: number;
    maxEdges?: number;
    nodeCount: number;
    edgeCount: number;
    truncated: boolean;
    exhausted: boolean;
};
