export type ToolSchemaVersion = `${number}.${number}.${number}` | `${number}-${number}-${number}`;

export type ToolSchemaMode = "compat" | "strict";

export type ToolVisibility = "public" | "internal" | "compat";

export type ToolSpec = {
  name: string;
  description: string;
  schemaVersion: ToolSchemaVersion;
  visibility: ToolVisibility;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
    additionalProperties?: boolean;
  };
  compat?: {
    aliases?: Array<{
      from: string;
      to: string;
      policy: "warn" | "deprecate" | "error";
      message: string;
      since?: ToolSchemaVersion;
      removeAfter?: ToolSchemaVersion;
    }>;
    valueAliases?: Array<{
      path: string;
      from: string;
      to: string;
      policy: "warn" | "deprecate" | "error";
      message: string;
      since?: ToolSchemaVersion;
      removeAfter?: ToolSchemaVersion;
    }>;
    coercions?: Array<{
      path: string;
      from: "string";
      to: "number";
      policy: "warn" | "error";
    }>;
    defaults?: Array<{ path: string; value: any }>;
  };
};

export class ToolSpecRegistry {
  constructor(private readonly specs: ToolSpec[]) {}

  listTools(options: { exposeInternal: boolean; exposeCompat: boolean }): ToolSpec[] {
    return this.specs.filter((spec) => {
      if (spec.visibility === "public") return true;
      if (spec.visibility === "internal") return options.exposeInternal;
      if (spec.visibility === "compat") return options.exposeCompat;
      return false;
    });
  }

  get(name: string): ToolSpec | undefined {
    return this.specs.find((spec) => spec.name === name);
  }
}

const SCHEMA_VERSION: ToolSchemaVersion = "2026-01-12";

const DEFAULT_ADDITIONAL_PROPERTIES = false;

export function createDefaultToolSpecRegistry(): ToolSpecRegistry {
  const internalTools: ToolSpec[] = [
    {
      name: "code_read",
      description: "Read file content in full, skeleton, or fragment modes.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          view: { type: "string", enum: ["full", "skeleton", "fragment"] },
          lineRange: { type: "string" }
        },
        required: ["filePath"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      },
      compat: {
        valueAliases: [
          {
            path: "view",
            from: "raw",
            to: "full",
            policy: "deprecate",
            message: "Use view=full instead of view=raw.",
            since: SCHEMA_VERSION
          }
        ]
      }
    },
    {
      name: "project_search",
      description: "Search for symbols, files, or content across the project.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
          patterns: { type: "array", items: { type: "string" } },
          type: { type: "string", enum: ["auto", "file", "symbol", "directory", "filename"] },
          semanticSymbols: { type: "boolean" },
          repoScope: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["all", "default", "repos"] },
              repoIds: { type: "array", items: { type: "string" } }
            }
          },
          repoId: { type: "string" },
          repoIds: { type: "array", items: { type: "string" } },
          maxResults: { type: "number" },
          limit: { type: "number" }
        },
        required: ["query"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "symbol_semantic_search",
      description: "Semantic search over code symbols (opt-in).",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          maxResults: { type: "number" },
          minSimilarity: { type: "number" },
          symbolTypes: {
            type: "array",
            items: { type: "string", enum: ["class", "function", "method", "interface", "type", "any"] }
          }
        },
        required: ["query"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "document_search",
      description: "Search project documents (md/mdx/txt/html/css + well-known text files) with hybrid ranking (BM25 + vector). Optionally include code comments as a separate corpus (kind=\"code_comment\").",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          scope: { type: "string", enum: ["all", "docs", "project"] },
          output: { type: "string", enum: ["full", "compact", "pack_only"] },
          packId: { type: "string" },
          repoScope: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["all", "default", "repos"] },
              repoIds: { type: "array", items: { type: "string" } }
            }
          },
          repoId: { type: "string" },
          repoIds: { type: "array", items: { type: "string" } },
          maxResults: { type: "number" },
          maxCandidates: { type: "number" },
          maxChunkCandidates: { type: "number" },
          maxVectorCandidates: { type: "number" },
          maxEvidenceSections: { type: "number" },
          maxEvidenceChars: { type: "number" },
          includeEvidence: { type: "boolean" },
          snippetLength: { type: "number" },
          rrfK: { type: "number" },
          rrfDepth: { type: "number" },
          useMmr: { type: "boolean" },
          mmrLambda: { type: "number" },
          maxChunksEmbeddedPerRequest: { type: "number" },
          maxEmbeddingTimeMs: { type: "number" },
          includeComments: { type: "boolean" },
          includeLogs: { type: "boolean" },
          includeMetrics: { type: "boolean" },
          embedding: {
            type: "object",
            properties: {
              provider: { type: "string", enum: ["auto", "local", "hash", "disabled"] },
              normalize: { type: "boolean" },
              batchSize: { type: "number" },
              modelDir: { type: "string" },
              local: {
                type: "object",
                properties: {
                  model: { type: "string" },
                  dims: { type: "number" }
                }
              }
            }
          }
        },
        required: ["query"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "document_references",
      description: "List resolved references (links) found in a markdown/MDX document.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          options: { type: "object" },
          limits: {
            type: "object",
            properties: {
              maxChars: { type: "number" },
              maxFileBytes: { type: "number" },
              sampleHeadBytes: { type: "number" },
              sampleTailBytes: { type: "number" },
              maxTimeMs: { type: "number" }
            }
          },
          extract: {
            type: "object",
            properties: {
              profile: { type: "string", enum: ["index", "full"] }
            }
          }
        },
        required: ["filePath"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "relationship_analyze",
      description: "Analyze dependencies, call graphs, data flow, or impact.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
          mode: { type: "string", enum: ["impact", "dependencies", "calls", "data_flow", "types"] },
          direction: { type: "string", enum: ["upstream", "downstream", "both"] },
          contextPath: { type: "string" },
          maxDepth: { type: "number" },
          fromLine: { type: "number" },
          semanticSymbols: { type: "boolean" }
        },
        required: ["target", "mode"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "edit_apply",
      description: "Apply structured edits to files with optional dry-run.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          edits: { type: "array", items: { type: "object" } },
          dryRun: { type: "boolean" },
          diffMode: { type: "string", enum: ["myers", "semantic"] },
          createMissingDirectories: { type: "boolean" },
          fileVersions: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                expectedVersion: { type: "number" },
                expectedHash: { type: "string" }
              }
            }
          },
          options: {
            type: "object",
            properties: {
              applyMode: { type: "string", enum: ["atomic", "partial"] },
              deleteMode: { type: "string", enum: ["forbid", "confirm"] },
              ordering: { type: "string", enum: ["stable", "creates_first"] }
            }
          },
          override: {
            type: "object",
            properties: {
              approval: {
                type: "object",
                properties: {
                  approvedBy: { type: "string" },
                  reason: { type: "string" },
                  ticket: { type: "string" },
                  issuedAt: { type: "string" },
                  expiresAt: { type: "string" },
                  method: { type: "string", enum: ["manual", "break_glass"] }
                }
              },
              scope: {
                type: "object",
                properties: {
                  pillars: { type: "array", items: { type: "string", enum: ["change", "write", "edit_apply"] } },
                  fileGlobs: { type: "array", items: { type: "string" } },
                  repoIds: { type: "array", items: { type: "string" } },
                  maxFiles: { type: "number" }
                }
              },
              allow: {
                type: "object",
                properties: {
                  integrityGuardrails: {
                    type: "object",
                    properties: { bypass: { type: "boolean" } }
                  },
                  architecturalSafety: {
                    type: "object",
                    properties: { bypass: { type: "boolean" } }
                  },
                  reviewPolicy: {
                    type: "object",
                    properties: { bypassPreApplyBlock: { type: "boolean" } }
                  },
                  parityGate: {
                    type: "object",
                    properties: { bypassL3Blocks: { type: "boolean" } }
                  },
                  staleGuard: {
                    type: "object",
                    properties: { bypass: { type: "boolean" } }
                  },
                  editPolicy: {
                    type: "object",
                    properties: {
                      allowPartialApply: { type: "boolean" },
                      allowDelete: { type: "string", enum: ["confirm_only"] }
                    }
                  }
                }
              }
            }
          }
        },
        required: ["edits"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "file_edit",
      description: "Apply structured edits to a single file.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          edits: { type: "array", items: { type: "object" } },
          dryRun: { type: "boolean" }
        },
        required: ["filePath", "edits"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "edit_guidance",
      description: "Suggests batch edit groupings and companion changes.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          filePaths: { type: "array", items: { type: "string" } },
          pattern: { type: "string" }
        },
        required: ["filePaths"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
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
              "test",
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
              "sessions",
              "session",
              "session_complete",
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
          pruneOptions: {
            type: "object",
            properties: {
              targets: {
                type: "array",
                items: { type: "string", enum: ["evidence_packs", "chunk_summaries", "flow_artifacts"] }
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
    },
    {
      name: "edit_transaction",
      description: "Run an edit transaction with preview or apply.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          target: { type: "string" },
          path: { type: "string" },
          edits: { type: "array", items: { type: "object" } },
          dryRun: { type: "boolean" },
          options: { type: "object" },
          fileVersions: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                expectedVersion: { type: "number" },
                expectedHash: { type: "string" }
              }
            }
          }
        },
        required: [],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "hotspot_detect",
      description: "Detect hotspot files from recent analysis.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "reference_find",
      description: "Find references for a symbol.",
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
      name: "project_profile",
      description: "Summarize project stats.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "document_toc",
      description: "Generate document outline and profile.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          options: { type: "object" },
          limits: {
            type: "object",
            properties: {
              maxChars: { type: "number" },
              maxFileBytes: { type: "number" },
              sampleHeadBytes: { type: "number" },
              sampleTailBytes: { type: "number" },
              maxTimeMs: { type: "number" }
            }
          },
          extract: {
            type: "object",
            properties: {
              profile: { type: "string", enum: ["index", "full"] }
            }
          }
        },
        required: ["filePath"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "document_skeleton",
      description: "Generate document skeleton and outline.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          options: { type: "object" },
          limits: {
            type: "object",
            properties: {
              maxChars: { type: "number" },
              maxFileBytes: { type: "number" },
              sampleHeadBytes: { type: "number" },
              sampleTailBytes: { type: "number" },
              maxTimeMs: { type: "number" }
            }
          },
          extract: {
            type: "object",
            properties: {
              profile: { type: "string", enum: ["index", "full"] }
            }
          }
        },
        required: ["filePath"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "document_section",
      description: "Read a specific document section.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          sectionId: { type: "string" },
          headingPath: { type: "array", items: { type: "string" } },
          includeSubsections: { type: "boolean" },
          mode: { type: "string", enum: ["summary", "preview", "raw"] },
          maxChars: { type: "number" },
          limits: {
            type: "object",
            properties: {
              maxChars: { type: "number" },
              maxFileBytes: { type: "number" },
              sampleHeadBytes: { type: "number" },
              sampleTailBytes: { type: "number" },
              maxTimeMs: { type: "number" }
            }
          },
          extract: {
            type: "object",
            properties: {
              profile: { type: "string", enum: ["index", "full"] }
            }
          }
        },
        required: ["filePath"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "document_analyze",
      description: "Analyze document structure and references.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          options: { type: "object" },
          limits: {
            type: "object",
            properties: {
              maxChars: { type: "number" },
              maxFileBytes: { type: "number" },
              sampleHeadBytes: { type: "number" },
              sampleTailBytes: { type: "number" },
              maxTimeMs: { type: "number" }
            }
          },
          extract: {
            type: "object",
            properties: {
              profile: { type: "string", enum: ["index", "full"] }
            }
          }
        },
        required: ["filePath"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    }
  ];

  const pillarTools: ToolSpec[] = [
    {
      name: "task",
      description: "High-level router for ask/analyze/plan workflows.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "public",
      inputSchema: {
        type: "object",
        properties: {
          request: { type: "string" },
          mode: { type: "string", enum: ["auto", "ask", "analyze", "plan_change", "apply_change", "write", "verify"] },
          budget: { type: "string", enum: ["lean", "balanced", "deep"] },
          sessionId: { type: "string" },
          draftId: { type: "string" },
          applyToken: { type: "string" },
          refinement: { type: "string" },
          edits: { type: "array", items: { type: "object" } },
          paths: { type: "array", items: { type: "string" } },
          targetFiles: { type: "array", items: { type: "string" } },
          targetPath: { type: "string" },
          safety: { type: "string", enum: ["plan", "apply"] },
          output: {
            type: "object",
            properties: {
              format: { type: "string", enum: ["summary", "standard"] },
              maxTokens: { type: "number" },
              maxChars: { type: "number" }
            }
          },
          trace: { type: "boolean" }
        },
        required: ["request"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "understand",
      description: "Deeply analyzes code structure and architecture.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "public",
      inputSchema: {
        type: "object",
        properties: {
          goal: { type: "string" },
          profile: { type: "string", enum: ["lean", "fast", "balanced", "deep"] },
          sources: { type: "string", enum: ["code", "docs", "both"] },
          depth: { type: "string", enum: ["shallow", "standard", "deep"] },
          scope: { type: "string", enum: ["symbol", "file", "module", "project"] },
          include: {
            type: "object",
            properties: {
              callGraph: { type: "boolean" },
              hotSpots: { type: "boolean" },
              pageRank: { type: "boolean" },
              dependencies: { type: "boolean" },
              clusters: { type: "boolean" }
            }
          },
          sessionId: { type: "string" },
          trace: { type: "boolean" },
          vibe: {
            type: "object",
            properties: {
              extract: { type: "boolean" },
              scope: { type: "string" },
              includeNorms: { type: "boolean" }
            }
          },
          analysis: {
            type: "object",
            properties: {
              clusters: { type: "boolean" },
              maxClusters: { type: "number" },
              maxFilesPerCluster: { type: "number" }
            }
          },
          clusterOptions: {
            type: "object",
            properties: {
              maxClusters: { type: "number" },
              expansionDepth: { type: "number" },
              includePreview: { type: "boolean" }
            }
          },
          allowCrossRepoEdits: { type: "boolean" },
          limits: {
            type: "object",
            properties: {
              maxTokens: { type: "number" },
              maxChars: { type: "number" },
              timeoutMs: { type: "number" }
            }
          }
        },
        required: ["goal"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      },
      compat: {
        aliases: [
          {
            from: "limits.max_tokens",
            to: "limits.maxTokens",
            policy: "deprecate",
            message: "Use limits.maxTokens instead of limits.max_tokens.",
            since: SCHEMA_VERSION
          }
        ],
        coercions: [
          {
            path: "limits.maxTokens",
            from: "string",
            to: "number",
            policy: "warn"
          }
        ]
      }
    },
    {
      name: "explore",
      description: "Unified discovery for docs/code with previews, sections, and controlled full reads.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "public",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          paths: { type: "array", items: { type: "string" } },
          profile: { type: "string", enum: ["lean", "fast", "balanced", "deep"] },
          sources: { type: "string", enum: ["code", "docs", "both"] },
          view: { type: "string", enum: ["auto", "preview", "section", "full"] },
          include: {
            type: "object",
            properties: {
              docs: { type: "boolean" },
              code: { type: "boolean" },
              comments: { type: "boolean" },
              logs: { type: "boolean" },
              clusters: { type: "boolean" }
            }
          },
          sessionId: { type: "string" },
          trace: { type: "boolean" },
          research: {
            type: "object",
            properties: {
              sketch: { type: "boolean" },
              topN: { type: "number" },
              format: { type: "string", enum: ["ascii", "mermaid", "both"] }
            }
          },
          repoScope: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["all", "default", "repos"] },
              repoIds: { type: "array", items: { type: "string" } }
            }
          },
          repoId: { type: "string" },
          repoIds: { type: "array", items: { type: "string" } },
          allowCrossRepoEdits: { type: "boolean" },
          section: {
            type: "object",
            properties: {
              sectionId: { type: "string" },
              headingPath: { type: "array", items: { type: "string" } },
              includeSubsections: { type: "boolean" }
            }
          },
          packId: { type: "string" },
          cursor: {
            type: "object",
            properties: {
              items: { type: "string" },
              content: { type: "string" }
            }
          },
          limits: {
            type: "object",
            properties: {
              maxResults: { type: "number" },
              maxChars: { type: "number" },
              maxItemChars: { type: "number" },
              maxBytes: { type: "number" },
              maxFiles: { type: "number" },
              maxTokens: { type: "number" },
              timeoutMs: { type: "number" }
            }
          },
          clusterOptions: {
            type: "object",
            properties: {
              maxClusters: { type: "number" },
              expansionDepth: { type: "number" },
              includePreview: { type: "boolean" }
            }
          },
          fullPaths: { type: "array", items: { type: "string" } },
          allowSensitive: { type: "boolean" },
          allowBinary: { type: "boolean" },
          allowGlobs: { type: "boolean" }
        },
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      },
      compat: {
        aliases: [
          {
            from: "limits.max_tokens",
            to: "limits.maxTokens",
            policy: "deprecate",
            message: "Use limits.maxTokens instead of limits.max_tokens.",
            since: SCHEMA_VERSION
          }
        ],
        valueAliases: [
          {
            path: "view",
            from: "raw",
            to: "full",
            policy: "deprecate",
            message: "Use view=full instead of view=raw.",
            since: SCHEMA_VERSION
          }
        ],
        coercions: [
          {
            path: "limits.maxTokens",
            from: "string",
            to: "number",
            policy: "warn"
          }
        ]
      }
    },
    {
      name: "change",
      description: "Safely modifies code with impact analysis.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "public",
      inputSchema: {
        type: "object",
        properties: {
          intent: { type: "string" },
          profile: { type: "string", enum: ["lean", "fast", "balanced", "deep"] },
          safety: { type: "string", enum: ["plan", "apply"] },
          target: { type: "string" },
          targetFiles: { type: "array", items: { type: "string" } },
          edits: { type: "array", items: { type: "object" } },
          sessionId: { type: "string" },
          trace: { type: "boolean" },
          stylePack: { anyOf: [{ type: "string" }, { type: "object" }] },
          draftOptions: {
            type: "object",
            properties: {
              skeletonOnly: { type: "boolean" },
              includeImpact: { type: "boolean" }
            }
          },
          draftId: { type: "string" },
          applyToken: { type: "string" },
          refinement: { type: "string" },
          repoScope: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["all", "default", "repos"] },
              repoIds: { type: "array", items: { type: "string" } }
            }
          },
          repoId: { type: "string" },
          repoIds: { type: "array", items: { type: "string" } },
          allowCrossRepoEdits: { type: "boolean" },
          reviewOptions: {
            type: "object",
            properties: {
              preApply: { type: "boolean" },
              postApply: { type: "boolean" },
              strictness: { type: "string", enum: ["strict", "balanced", "permissive"] },
              blockOn: { type: "array", items: { type: "string", enum: ["syntax", "semantic", "guardrails", "vibe"] } }
            }
          },
          options: {
            type: "object",
            properties: {
              dryRun: { type: "boolean" },
              includeImpact: { type: "boolean" },
              includeSymbolImpact: { type: "boolean" },
              autoRollback: { type: "boolean" },
              batchMode: { type: "boolean" },
              suggestDocs: { type: "boolean" },
              batchImpactLimit: { type: "number" }
            }
          },
          strategySearch: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["off", "auto", "force"] },
              stage: { type: "string", enum: ["r0", "r1", "r2", "r3"] },
              candidates: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    intent: { type: "string" },
                    target: { type: "string" },
                    targetFiles: { type: "array", items: { type: "string" } },
                    edits: { type: "array", items: { type: "object" } },
                    children: { type: "array", items: { type: "object" } },
                    options: {
                      type: "object",
                      properties: {
                        diffMode: { type: "string", enum: ["myers", "semantic"] },
                        includeImpact: { type: "boolean" }
                      }
                    },
                    notes: { type: "string" }
                  }
                }
              },
              maxCandidates: { type: "number" },
              timeboxMs: { type: "number" },
              maxSimulationMs: { type: "number" },
              maxImpactMs: { type: "number" },
              maxTouchedFiles: { type: "number" },
              maxTokensEstimated: { type: "number" },
              scoring: {
                type: "object",
                properties: {
                  weights: {
                    type: "object",
                    properties: {
                      files: { type: "number" },
                      diff: { type: "number" },
                      tokens: { type: "number" },
                      risk: { type: "number" },
                      breaking: { type: "number" },
                      contract: { type: "number" },
                      guardsHigh: { type: "number" }
                    }
                  }
                }
              },
              mcts: {
                type: "object",
                properties: {
                  maxDepth: { type: "number" },
                  maxRollouts: { type: "number" },
                  exploration: { type: "number" },
                  seed: { type: "number" }
                }
              }
            }
          },
          override: {
            type: "object",
            properties: {
              approval: {
                type: "object",
                properties: {
                  approvedBy: { type: "string" },
                  reason: { type: "string" },
                  ticket: { type: "string" },
                  issuedAt: { type: "string" },
                  expiresAt: { type: "string" },
                  method: { type: "string", enum: ["manual", "break_glass"] }
                }
              },
              scope: {
                type: "object",
                properties: {
                  pillars: { type: "array", items: { type: "string", enum: ["change", "write"] } },
                  fileGlobs: { type: "array", items: { type: "string" } },
                  repoIds: { type: "array", items: { type: "string" } },
                  maxFiles: { type: "number" }
                }
              },
              allow: {
                type: "object",
                properties: {
                  integrityGuardrails: {
                    type: "object",
                    properties: { bypass: { type: "boolean" } }
                  },
                  architecturalSafety: {
                    type: "object",
                    properties: { bypass: { type: "boolean" } }
                  },
                  reviewPolicy: {
                    type: "object",
                    properties: { bypassPreApplyBlock: { type: "boolean" } }
                  },
                  parityGate: {
                    type: "object",
                    properties: { bypassL3Blocks: { type: "boolean" } }
                  },
                  staleGuard: {
                    type: "object",
                    properties: { bypass: { type: "boolean" } }
                  },
                  editPolicy: {
                    type: "object",
                    properties: {
                      allowPartialApply: { type: "boolean" },
                      allowDelete: { type: "string", enum: ["confirm_only"] }
                    }
                  }
                }
              }
            }
          }
        },
        required: ["intent"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "write",
      description: "Creates new files or scaffolds content.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "public",
      inputSchema: {
        type: "object",
        properties: {
          intent: { type: "string" },
          profile: { type: "string", enum: ["lean", "fast", "balanced", "deep"] },
          safety: { type: "string", enum: ["plan", "apply"] },
          targetPath: { type: "string" },
          template: { type: "string" },
          content: { type: "string" },
          dryRun: { type: "boolean" },
          sessionId: { type: "string" },
          trace: { type: "boolean" },
          stylePack: { anyOf: [{ type: "string" }, { type: "object" }] },
          draftOptions: {
            type: "object",
            properties: {
              skeletonOnly: { type: "boolean" },
              includeImpact: { type: "boolean" }
            }
          },
          draftId: { type: "string" },
          applyToken: { type: "string" },
          refinement: { type: "string" },
          repoScope: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["all", "default", "repos"] },
              repoIds: { type: "array", items: { type: "string" } }
            }
          },
          repoId: { type: "string" },
          repoIds: { type: "array", items: { type: "string" } },
          allowCrossRepoEdits: { type: "boolean" },
          reviewOptions: {
            type: "object",
            properties: {
              preApply: { type: "boolean" },
              postApply: { type: "boolean" },
              strictness: { type: "string", enum: ["strict", "balanced", "permissive"] },
              blockOn: { type: "array", items: { type: "string", enum: ["syntax", "semantic", "guardrails", "vibe"] } }
            }
          },
          options: {
            type: "object",
            properties: {
              safeWrite: { type: "boolean" },
              quickGenerate: { type: "boolean" },
              smartWrite: { type: "boolean" },
              styleReference: { type: "array", items: { type: "string" } }
            }
          },
          override: {
            type: "object",
            properties: {
              approval: {
                type: "object",
                properties: {
                  approvedBy: { type: "string" },
                  reason: { type: "string" },
                  ticket: { type: "string" },
                  issuedAt: { type: "string" },
                  expiresAt: { type: "string" },
                  method: { type: "string", enum: ["manual", "break_glass"] }
                }
              },
              scope: {
                type: "object",
                properties: {
                  pillars: { type: "array", items: { type: "string", enum: ["change", "write"] } },
                  fileGlobs: { type: "array", items: { type: "string" } },
                  repoIds: { type: "array", items: { type: "string" } },
                  maxFiles: { type: "number" }
                }
              },
              allow: {
                type: "object",
                properties: {
                  integrityGuardrails: {
                    type: "object",
                    properties: { bypass: { type: "boolean" } }
                  },
                  architecturalSafety: {
                    type: "object",
                    properties: { bypass: { type: "boolean" } }
                  },
                  reviewPolicy: {
                    type: "object",
                    properties: { bypassPreApplyBlock: { type: "boolean" } }
                  },
                  parityGate: {
                    type: "object",
                    properties: { bypassL3Blocks: { type: "boolean" } }
                  },
                  staleGuard: {
                    type: "object",
                    properties: { bypass: { type: "boolean" } }
                  },
                  editPolicy: {
                    type: "object",
                    properties: {
                      allowPartialApply: { type: "boolean" },
                      allowDelete: { type: "string", enum: ["confirm_only"] }
                    }
                  }
                }
              }
            }
          }
        },
        required: ["intent"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "manage",
      description: "Manages project state and transactions.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "public",
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
              "rebuild",
              "history",
              "test",
              "init",
              "doctor",
              "schema",
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
          scope: { type: "string", enum: ["file", "transaction", "project", "config", "languages", "wasm", "host", "contracts", "parity", "capabilities"] },
          tool: { type: "string" },
          target: { type: "string" },
          targetType: { type: "string", enum: ["artifact", "transaction", "patchRef"] },
          format: { type: "string", enum: ["unified_diff", "structured_edits", "both"] },
          limit: { type: "number" },
          checkpointLimit: { type: "number" },
          detail: { type: "string", enum: ["summary", "full"] },
          trace: { type: "boolean" },
          outcome: { type: "object" },
          sessionId: { type: "string" },
          policy: { type: "object" },
          policyMode: { type: "string", enum: ["merge", "replace"] },
          paths: { type: "array", items: { type: "string" } },
          limits: {
            type: "object",
            properties: {
              maxTokens: { type: "number" },
              maxChars: { type: "number" }
            }
          },
          artifactOptions: {
            type: "object",
            properties: {
              type: { type: "string" },
              sessionId: { type: "string" },
              limit: { type: "number" },
              includeExpired: { type: "boolean" }
            }
          },
          allowExternal: { type: "boolean" },
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
          pruneOptions: {
            type: "object",
            properties: {
              targets: {
                type: "array",
                items: { type: "string", enum: ["evidence_packs", "chunk_summaries", "flow_artifacts"] }
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
      name: "navigate",
      description: "Find relevant files, symbols, or docs for a target.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "internal",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
          limit: { type: "number" },
          context: { type: "string", enum: ["all", "definitions", "usages", "tests", "docs"] },
          include: {
            type: "object",
            properties: {
              hotSpots: { type: "boolean" },
              pageRank: { type: "boolean" },
              relatedSymbols: { type: "boolean" },
              clusters: { type: "boolean" }
            }
          },
          clusterOptions: {
            type: "object",
            properties: {
              maxClusters: { type: "number" },
              expansionDepth: { type: "number" },
              includePreview: { type: "boolean" }
            }
          },
          allowCrossRepoEdits: { type: "boolean" },
          trace: { type: "boolean" }
        },
        required: ["target"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    }
  ];

  const compatTools: ToolSpec[] = [
    {
      name: "file_read",
      description: "Returns Smart File Profile or raw file content.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "compat",
      inputSchema: {
        type: "object",
        properties: { filePath: { type: "string" }, full: { type: "boolean" } },
        required: ["filePath"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      },
      compat: {
        aliases: [
          {
            from: "raw",
            to: "full",
            policy: "deprecate",
            message: "Use full instead of raw.",
            since: SCHEMA_VERSION
          }
        ]
      }
    },
    {
      name: "file_write",
      description: "Writes or creates a file with provided content.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "compat",
      inputSchema: {
        type: "object",
        properties: { filePath: { type: "string" }, content: { type: "string" } },
        required: ["filePath", "content"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    },
    {
      name: "file_analyze",
      description: "Analyze a single file and return summary metadata.",
      schemaVersion: SCHEMA_VERSION,
      visibility: "compat",
      inputSchema: {
        type: "object",
        properties: { filePath: { type: "string" } },
        required: ["filePath"],
        additionalProperties: DEFAULT_ADDITIONAL_PROPERTIES
      }
    }
  ];

  return new ToolSpecRegistry([...internalTools, ...pillarTools, ...compatTools]);
}
