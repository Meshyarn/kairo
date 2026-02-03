import * as path from "path";
import type { ModuleResolver } from "./ModuleResolver.js";
import type { SymbolIndex } from "./SymbolIndex.js";
import type {
  CallConfidence,
  CallSiteInfo,
  DefinitionSymbol,
  ImportSymbol,
  SymbolInfo
} from "../types.js";
import type {
  DefinitionLocation,
  FileSymbolContext,
  ImportBinding,
  ResolvedCallTarget
} from "./CallGraphBuilderTypes.js";

type FileContextArgs = {
  absPath: string;
  symbolIndex: SymbolIndex;
  fileContextCache: Map<string, FileSymbolContext>;
  normalizeRelativePath: (absPath: string) => string;
};

export const getFileContext = async (args: FileContextArgs): Promise<FileSymbolContext | null> => {
  const cacheKey = getFileContextCacheKey(args.absPath);
  if (args.fileContextCache.has(cacheKey)) {
    return args.fileContextCache.get(cacheKey)!;
  }

  try {
    const symbols = await args.symbolIndex.getSymbolsForFile(args.absPath);
    return buildFileContext({
      absPath: args.absPath,
      symbols,
      fileContextCache: args.fileContextCache,
      normalizeRelativePath: args.normalizeRelativePath
    });
  } catch {
    return null;
  }
};

export const buildFileContext = (args: {
  absPath: string;
  symbols: SymbolInfo[];
  fileContextCache: Map<string, FileSymbolContext>;
  normalizeRelativePath: (absPath: string) => string;
}): FileSymbolContext => {
  const relativePath = args.normalizeRelativePath(args.absPath);
  const definitions: DefinitionSymbol[] = [];
  const imports: ImportSymbol[] = [];

  for (const symbol of args.symbols) {
    if (isDefinition(symbol)) {
      definitions.push(symbol);
    } else if (isImportSymbol(symbol)) {
      imports.push(symbol);
    }
  }

  const context: FileSymbolContext = { absPath: args.absPath, relativePath, definitions, imports };
  const cacheKey = getFileContextCacheKey(args.absPath);
  args.fileContextCache.set(cacheKey, context);
  return context;
};

export const resolveCallTargets = async (args: {
  call: CallSiteInfo;
  context: FileSymbolContext;
  moduleResolver: ModuleResolver;
  getFileContext: (absPath: string) => Promise<FileSymbolContext | null>;
  makeSymbolId: (filePath: string, symbolName: string) => string;
  definitionRegistryProvider?: () => Promise<Map<string, DefinitionLocation[]>>;
}): Promise<ResolvedCallTarget[]> => {
  const results: ResolvedCallTarget[] = [];
  const seen = new Set<string>();

  const pushTarget = (target: DefinitionLocation, confidence: CallConfidence) => {
    const symbolId = args.makeSymbolId(target.relativePath, target.definition.name);
    if (seen.has(symbolId)) {
      return;
    }
    seen.add(symbolId);
    results.push({ ...target, confidence });
  };

  const localMatches = findLocalMatches(args.call, args.context);
  for (const match of localMatches) {
    pushTarget(match, "definite");
  }

  const importMatches = await findImportMatches({
    call: args.call,
    context: args.context,
    moduleResolver: args.moduleResolver,
    getFileContext: args.getFileContext
  });
  for (const match of importMatches) {
    pushTarget(match.location, match.confidence);
  }

  if (results.length === 0 && args.definitionRegistryProvider) {
    const registry = await args.definitionRegistryProvider();
    const fallback = registry.get(args.call.calleeName) || [];
    for (const location of fallback) {
      pushTarget(location, "inferred");
    }
  }

  return results;
};

const isDefinition = (symbol: SymbolInfo): symbol is DefinitionSymbol => {
  return symbol.type !== "import" && symbol.type !== "export";
};

const isImportSymbol = (symbol: SymbolInfo): symbol is ImportSymbol => {
  return symbol.type === "import";
};

const getFileContextCacheKey = (absPath: string): string => {
  return path.normalize(absPath);
};

const findLocalMatches = (call: CallSiteInfo, context: FileSymbolContext): DefinitionLocation[] => {
  if (call.calleeObject && !["this", "super", "self"].includes(call.calleeObject)) {
    return [];
  }
  const matches = context.definitions.filter(def => def.name === call.calleeName);
  return matches.map(def => ({
    definition: def,
    absPath: context.absPath,
    relativePath: context.relativePath
  }));
};

const findImportMatches = async (args: {
  call: CallSiteInfo;
  context: FileSymbolContext;
  moduleResolver: ModuleResolver;
  getFileContext: (absPath: string) => Promise<FileSymbolContext | null>;
}): Promise<Array<{ location: DefinitionLocation; confidence: CallConfidence }>> => {
  const bindings = getImportBindings(args.context);
  const matches: Array<{ location: DefinitionLocation; confidence: CallConfidence }> = [];

  const relevant = bindings.filter(binding => {
    if (binding.isTypeOnly) return false;
    if (args.call.calleeObject) {
      return binding.alias === args.call.calleeObject;
    }
    return binding.alias === args.call.calleeName;
  });

  for (const binding of relevant) {
    const targetName = getTargetNameForBinding(binding, args.call);
    const locations = await resolveBinding(binding, targetName, args.context, args.moduleResolver, args.getFileContext);
    const confidence: CallConfidence = binding.importKind === "named" ? "definite" : "possible";
    for (const location of locations) {
      matches.push({ location, confidence });
    }
  }

  return matches;
};

const getTargetNameForBinding = (binding: ImportBinding, call: CallSiteInfo): string | undefined => {
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
};

const resolveBinding = async (
  binding: ImportBinding,
  targetName: string | undefined,
  context: FileSymbolContext,
  moduleResolver: ModuleResolver,
  getContext: (absPath: string) => Promise<FileSymbolContext | null>
): Promise<DefinitionLocation[]> => {
  const resolvedPath = moduleResolver.resolve(context.absPath, binding.source);
  if (!resolvedPath) {
    return [];
  }
  const targetContext = await getContext(resolvedPath);
  if (!targetContext) {
    return [];
  }

  const definitions = pickDefinitionsForBinding(binding, targetName, targetContext);
  return definitions.map(def => ({
    definition: def,
    absPath: resolvedPath,
    relativePath: targetContext.relativePath
  }));
};

const pickDefinitionsForBinding = (binding: ImportBinding, targetName: string | undefined, context: FileSymbolContext): DefinitionSymbol[] => {
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
};

const getImportBindings = (context: FileSymbolContext): ImportBinding[] => {
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
};
