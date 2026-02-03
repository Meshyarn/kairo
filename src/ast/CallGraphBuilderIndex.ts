import * as path from "path";
import type { SymbolIndex } from "./SymbolIndex.js";
import type { DefinitionLocation, FileSymbolContext, GlobalCallSite, GlobalIndexData } from "./CallGraphBuilderTypes.js";
import { buildFileContext } from "./CallGraphBuilderContext.js";

export const buildGlobalIndex = async (args: {
  rootPath: string;
  symbolIndex: SymbolIndex;
  fileContextCache: Map<string, FileSymbolContext>;
  normalizeRelativePath: (absPath: string) => string;
}): Promise<GlobalIndexData> => {
  const entries = await args.symbolIndex.getAllSymbols();
  const definitionsByName = new Map<string, DefinitionLocation[]>();
  const callSitesByName = new Map<string, GlobalCallSite[]>();

  for (const [relativePath, symbols] of entries.entries()) {
    const absPath = path.isAbsolute(relativePath) ? relativePath : path.join(args.rootPath, relativePath);
    const context = buildFileContext({
      absPath,
      symbols,
      fileContextCache: args.fileContextCache,
      normalizeRelativePath: args.normalizeRelativePath
    });

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
};
