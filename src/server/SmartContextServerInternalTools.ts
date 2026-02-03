import type { InternalToolRegistry } from "../orchestration/InternalToolRegistry.js";
import type { SearchHandlers } from "../handlers/SearchHandlers.js";
import type { CodeHandlers } from "../handlers/CodeHandlers.js";
import type { EditHandlers } from "../handlers/EditHandlers.js";
import type { DocumentHandlers } from "../handlers/DocumentHandlers.js";
import type { ManageHandlers } from "../handlers/ManageHandlers.js";
import type { HotSpotDetector } from "../engine/ClusterSearch/HotSpotDetector.js";

export function registerInternalTools(args: {
  internalRegistry: InternalToolRegistry;
  searchHandlers: SearchHandlers;
  codeHandlers: CodeHandlers;
  editHandlers: EditHandlers;
  documentHandlers: DocumentHandlers;
  manageHandlers: ManageHandlers;
  hotSpotDetector: HotSpotDetector;
}): void {
  const {
    internalRegistry,
    searchHandlers,
    codeHandlers,
    editHandlers,
    documentHandlers,
    manageHandlers,
    hotSpotDetector
  } = args;

  internalRegistry.register("code_read", (innerArgs) => (codeHandlers as any).readCodeRaw(innerArgs));
  internalRegistry.register("project_search", (innerArgs) => (searchHandlers as any).searchProjectRaw(innerArgs));
  internalRegistry.register("symbol_semantic_search", (innerArgs) => (searchHandlers as any).searchSymbolSemanticRaw(innerArgs));
  internalRegistry.register("file_search", (innerArgs) => (searchHandlers as any).searchFilesRaw(innerArgs));
  internalRegistry.register("file_scout", (innerArgs) => (searchHandlers as any).scoutFilesRaw(innerArgs));
  internalRegistry.register("file_list", (innerArgs) => (codeHandlers as any).listFilesRaw(innerArgs));
  internalRegistry.register("file_stat", (innerArgs) => (codeHandlers as any).statFileRaw(innerArgs));
  internalRegistry.register("relationship_analyze", (innerArgs) => (codeHandlers as any).analyzeRelationshipRaw(innerArgs));
  internalRegistry.register("edit_apply", (innerArgs) => (editHandlers as any).editCodeRaw(innerArgs));
  internalRegistry.register("file_edit", (innerArgs) => (editHandlers as any).editFileRaw(innerArgs));
  internalRegistry.register("project_manage", (innerArgs) => (manageHandlers as any).manageProjectRaw(innerArgs));
  internalRegistry.register("file_profile", (innerArgs) => (codeHandlers as any).readFileProfileRaw(innerArgs));
  internalRegistry.register("file_write", (innerArgs) => (editHandlers as any).executeWriteFile(innerArgs));
  internalRegistry.register("impact_analyze", (innerArgs) => (editHandlers as any).executeImpactAnalyzer(innerArgs));
  internalRegistry.register("edit_transaction", (innerArgs) => (editHandlers as any).executeEditCoordinator(innerArgs));
  internalRegistry.register("hotspot_detect", () => hotSpotDetector.detectHotSpots());
  internalRegistry.register("reference_find", (innerArgs) => (codeHandlers as any).findReferencesRaw(innerArgs));
  internalRegistry.register("project_profile", () => (codeHandlers as any).projectStatsRaw());
  internalRegistry.register("document_toc", (innerArgs) => (documentHandlers as any).docTocRaw(innerArgs));
  internalRegistry.register("document_skeleton", (innerArgs) => (documentHandlers as any).docSkeletonRaw(innerArgs));
  internalRegistry.register("document_section", (innerArgs) => (documentHandlers as any).docSectionRaw(innerArgs));
  internalRegistry.register("document_analyze", (innerArgs) => (documentHandlers as any).docAnalyzeRaw(innerArgs));
  internalRegistry.register("document_search", (innerArgs) => (documentHandlers as any).docSearchRaw(innerArgs));
  internalRegistry.register("document_references", (innerArgs) => (documentHandlers as any).docReferencesRaw(innerArgs));
}
