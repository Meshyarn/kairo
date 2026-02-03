import type {
  CallConfidence,
  CallGraphEdge,
  CallGraphNode,
  CallSiteInfo,
  DefinitionSymbol,
  ImportSymbol,
} from "../types.js";

export type CallGraphDirection = "upstream" | "downstream" | "both";

export interface DefinitionLocation {
  definition: DefinitionSymbol;
  absPath: string;
  relativePath: string;
}

export interface FileSymbolContext {
  absPath: string;
  relativePath: string;
  definitions: DefinitionSymbol[];
  imports: ImportSymbol[];
  importBindings?: ImportBinding[];
}

export interface ImportBinding {
  alias: string;
  source: string;
  importKind: ImportSymbol["importKind"];
  importedName?: string;
  isTypeOnly?: boolean;
}

export interface ResolvedCallTarget extends DefinitionLocation {
  confidence: CallConfidence;
}

export interface GlobalCallSite {
  context: FileSymbolContext;
  definition: DefinitionSymbol;
  call: CallSiteInfo;
}

export interface GlobalIndexData {
  definitionsByName: Map<string, DefinitionLocation[]>;
  callSitesByName: Map<string, GlobalCallSite[]>;
}

export type CallGraphBudget = {
  maxNodes?: number;
  maxEdges?: number;
  nodeCount: number;
  edgeCount: number;
  truncated: boolean;
  exhausted: boolean;
};

export type CallGraphEdgeInput = Omit<CallGraphEdge, "fromSymbolId" | "toSymbolId">;

export type CallGraphNodeMap = Record<string, CallGraphNode>;
