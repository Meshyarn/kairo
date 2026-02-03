import type { ToolSpec } from "./ToolSpecTypes.js";
import { SCHEMA_VERSION, DEFAULT_ADDITIONAL_PROPERTIES, CONTENT_SOURCE_SCHEMA } from "./ToolSpecRegistrySchema.js";

export const ToolSpecRegistryInternalA: ToolSpec[] = [
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
    }
];
