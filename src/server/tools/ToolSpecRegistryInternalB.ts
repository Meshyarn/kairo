import type { ToolSpec } from "./ToolSpecTypes.js";
import { SCHEMA_VERSION, DEFAULT_ADDITIONAL_PROPERTIES, CONTENT_SOURCE_SCHEMA } from "./ToolSpecRegistrySchema.js";

export const ToolSpecRegistryInternalB: ToolSpec[] = [
    {
      name: "project_manage",
      description: "Manage project state (status, undo, redo, reindex).",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            enum: [
              "status",
              "undo",
              "redo",
              "reindex",
              "history",
              "schema",
              "metrics",
              "metrics_reset",
              "config",
              "init",
              "doctor",
              "audit",
              "symbol_index_build",
              "symbol_index_status",
              "symbol_index_clear",
              "switch_root",
              "detect_root",
              "sessions",
              "session",
              "session_complete",
              "session_update",
              "artifacts",
              "artifact",
              "discard",
              "prune",
              "export",
              "import"
            ]
          },
          detail: { type: "string", enum: ["summary", "full"] },
          tool: { type: "string" },
          target: { type: "string" },
          targetType: { type: "string", enum: ["artifact", "transaction", "patchRef"] },
          format: { type: "string", enum: ["unified_diff", "structured_edits", "both"] },
          paths: { type: "array", items: { type: "string" } },
          action: { type: "string", enum: ["tail", "query", "stats"] },
          limit: { type: "number" },
          since: { type: "string" },
          checkpointLimit: { type: "number" },
          filter: {
            type: "object",
            properties: {
              approvedBy: { type: "string" },
              pillar: { type: "string", enum: ["change", "write", "edit_apply", "manage"] },
              decision: { type: "string", enum: ["accepted", "rejected", "expired", "out_of_scope"] },
              overrideKind: { type: "string" }
            }
          },
          outcome: { type: "object" },
          mode: { type: "string", enum: ["plan", "apply"] },
          targets: { type: "array", items: { type: "string", enum: ["kairo", "vscode"] } },
          root: { type: "string" },
          multiRepo: { type: "string", enum: ["auto", "single", "detect"] },
          presets: { type: "string", enum: ["minimal", "recommended"] },
          languageScan: {
            type: "object",
            properties: {
              maxFiles: { type: "number" },
              sampleBytesPerFile: { type: "number" },
              includeDocs: { type: "boolean" }
            }
          },
          applyOptions: {
            type: "object",
            properties: {
              backup: { type: "boolean" },
              legacyMcpConfig: { type: "boolean" }
            }
          },
          cwd: { type: "string" },
          apply: { type: "boolean" },
          allowBroadRoot: { type: "boolean" },
          pruneOptions: {
            type: "object",
            properties: {
              targets: {
                type: "array",
                items: { type: "string", enum: ["evidence_packs", "chunk_summaries", "flow_artifacts", "temp_files"] }
              },
              includeExpired: { type: "boolean" },
              includeStale: { type: "boolean" },
              enforceCaps: { type: "boolean" },
              compact: { type: "boolean" },
              limits: {
                type: "object",
                properties: {
                  maxPacks: { type: "number" },
                  maxPackBytes: { type: "number" },
                  maxSummaryChunks: { type: "number" },
                  maxSummaryBytes: { type: "number" }
                }
              },
              flowArtifacts: {
                type: "object",
                properties: {
                  removeOrphans: { type: "boolean" }
                }
              }
            }
          }
        },
        required: ["command"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "interface_reconstruct",
      description: "Reconstruct a ghost interface based on observed call sites.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: { symbolName: { type: "string" } },
        required: ["symbolName"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "file_search",
      description: "Search for files via filename/pattern matching.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
          patterns: { type: "array", items: { type: "string" } },
          includeGlobs: { type: "array", items: { type: "string" } },
          excludeGlobs: { type: "array", items: { type: "string" } },
          fileTypes: { type: "array", items: { type: "string" } },
          snippetLength: { type: "number" },
          matchesPerFile: { type: "number" },
          groupByFile: { type: "boolean" },
          deduplicateByContent: { type: "boolean" },
          basePath: { type: "string" },
          smartCase: { type: "boolean" },
          caseSensitive: { type: "boolean" },
          wordBoundary: { type: "boolean" },
          maxResults: { type: "number" },
          limit: { type: "number" }
        },
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "file_scout",
      description: "Scans project files with basic filters.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
          patterns: { type: "array", items: { type: "string" } },
          includeGlobs: { type: "array", items: { type: "string" } },
          excludeGlobs: { type: "array", items: { type: "string" } },
          fileTypes: { type: "array", items: { type: "string" } },
          snippetLength: { type: "number" },
          matchesPerFile: { type: "number" },
          groupByFile: { type: "boolean" },
          deduplicateByContent: { type: "boolean" },
          basePath: { type: "string" },
          smartCase: { type: "boolean" },
          caseSensitive: { type: "boolean" },
          wordBoundary: { type: "boolean" },
          maxResults: { type: "number" },
          limit: { type: "number" }
        },
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "file_list",
      description: "List files under the current root.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          basePath: { type: "string" },
          depth: { type: "number" },
          maxFiles: { type: "number" }
        },
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "file_stat",
      description: "Stat a single file path.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "file_profile",
      description: "Read file profile metadata and structure.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          outlineOptions: { type: "object" }
        },
        required: ["filePath"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "file_fragment_read",
      description: "Read a file fragment by line range.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          contextLines: { type: "number" },
          lineRanges: {
            type: "array",
            items: {
              type: "object",
              properties: {
                start: { type: "number" },
                end: { type: "number" }
              }
            }
          },
          keywords: { type: "array", items: { type: "string" } }
        },
        required: ["filePath"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "impact_analyze",
      description: "Compute impact preview for a proposed edit.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
          filePath: { type: "string" },
          path: { type: "string" },
          edits: { type: "array", items: { type: "object" } }
        },
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    }
];
