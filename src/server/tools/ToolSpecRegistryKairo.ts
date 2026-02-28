import { SCHEMA_VERSION, DEFAULT_ADDITIONAL_PROPERTIES } from "./ToolSpecRegistrySchema.js";
import type { ToolSpec } from "./ToolSpecTypes.js";

export const kairoToolSpecs: ToolSpec[] = [
  {
    name: "kairo_search",
    description:
      "Semantic search across the project codebase and documents. " +
      "Finds conceptually related code even when exact keywords don't match. " +
      "Powered by Tantivy full-text index + vector embeddings. " +
      "Use native Grep for exact keyword/regex; use kairo_search for concept queries " +
      'like "find code that handles authentication" or "where is retry logic".',
    schemaVersion: SCHEMA_VERSION,
    visibility: "public",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language query" },
        scope: {
          type: "string",
          enum: ["code", "docs", "all"],
          description: "Search scope (default: code)",
        },
        limit: { type: "number", description: "Max results (default: 10)" },
        fileTypes: {
          type: "array",
          items: { type: "string" },
          description: "File extensions, e.g. ['ts','rs']",
        },
      },
      required: ["query"],
      additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES,
    },
  },
  {
    name: "kairo_impact",
    description:
      "Analyze ripple effects of changing a symbol, file, or module. " +
      "Traces dependency graphs, call hierarchies, and type relationships " +
      "to predict what breaks. Goes beyond LSP findReferences by propagating " +
      "through the full dependency chain. Use LSP for direct refs, kairo_impact for transitive impact.",
    schemaVersion: SCHEMA_VERSION,
    visibility: "public",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Symbol name, file path, or module to analyze",
        },
        depth: {
          type: "string",
          enum: ["shallow", "deep"],
          description: "Analysis depth (default: shallow)",
        },
        includeTests: {
          type: "boolean",
          description: "Include test file impacts (default: false)",
        },
      },
      required: ["target"],
      additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES,
    },
  },
  {
    name: "kairo_graph",
    description:
      "Get project structure: module relationships, dependency graph, " +
      "hot spots (most-referenced files), entry points, and file clusters. " +
      "Useful for understanding large codebases before making changes. " +
      "Use focus param to center on a specific file/module.",
    schemaVersion: SCHEMA_VERSION,
    visibility: "public",
    inputSchema: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          description: "File or module to center graph on (optional)",
        },
        scope: {
          type: "string",
          enum: ["module", "project"],
          description: "Graph scope (default: module)",
        },
        include: {
          type: "array",
          items: {
            type: "string",
            enum: ["hotSpots", "entryPoints", "clusters", "dependencies"],
          },
          description: "What to include (default: ['dependencies'])",
        },
      },
      additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES,
    },
  },
  {
    name: "kairo_undo",
    description:
      "Transaction-based undo/redo for code changes made through Kairo. " +
      "View change history with timestamps, undo recent modifications to restore previous state, " +
      "or redo undone changes. Works independently of git and tracks only Kairo-applied edits. " +
      "Use action=history to list recent changes, action=undo to revert, action=redo to reapply.",
    schemaVersion: SCHEMA_VERSION,
    visibility: "public",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["undo", "redo", "history"],
          description: "Action to perform (default: history)",
        },
        limit: {
          type: "number",
          description: "History entries to show (default: 5)",
        },
      },
      additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES,
    },
  },
  {
    name: "kairo_status",
    description:
      "Check Kairo index health and trigger reindexing. " +
      "Shows search index status, symbol coverage, last reindex time, and process diagnostics. " +
      "Use when search results seem stale. Use action=reindex to rebuild the index.",
    schemaVersion: SCHEMA_VERSION,
    visibility: "public",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["check", "reindex"],
          description:
            "check: view status, reindex: rebuild index (default: check)",
        },
        scope: {
          type: "string",
          enum: ["overview", "search", "symbols", "full"],
          description: "Detail level for check (default: overview)",
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description:
            "Files/dirs to reindex (empty = full reindex)",
        },
      },
      additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES,
    },
  },
];
