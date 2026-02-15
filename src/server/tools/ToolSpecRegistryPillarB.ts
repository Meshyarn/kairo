import type { ToolSpec } from "./ToolSpecTypes.js";
import { SCHEMA_VERSION, DEFAULT_ADDITIONAL_PROPERTIES, CONTENT_SOURCE_SCHEMA } from "./ToolSpecRegistrySchema.js";

export const ToolSpecRegistryPillarB: ToolSpec[] = [
    {
      name: "write",
      description: "Creates new files or scaffolds content with planning and safe-apply controls. Provide intent and targetPath, then choose template, content, or contentSource as needed. safety=plan prepares output for review; safety=apply writes with applyToken support. options and reviewOptions tune generation and validation behavior, while repoScope constrains where files are created. Use for docs, configs, and initial module scaffolding.",
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
          contentBase64: { type: "string" },
          contentSource: CONTENT_SOURCE_SCHEMA,
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
      description: "Administrative tool for workspace health, transactions, and artifacts. Use command status for index and runtime health, doctor for diagnostics by scope, schema for parameter docs (requires tool), history/undo/redo for transaction control, and reindex for rebuilds. artifact, artifacts, and sessions expose persisted outputs. init bootstraps workspace config and prune cleans storage. Example: manage({command:'schema', tool:'task'}).",
      schemaVersion: SCHEMA_VERSION,
      visibility: "public",
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Command to execute. schema requires tool (for example tool:'task'). artifact requires target (artifact id). doctor accepts scope (contracts|languages|parity|capabilities). prune accepts pruneOptions. init accepts targets and optional presets. status/history/undo/redo/reindex can run without extra required parameters.",
            enum: [
              "status",
              "undo",
              "redo",
              "reindex",
              "rebuild",
              "history",
              "init",
              "doctor",
              "schema",
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
          targets: { type: "array", items: { type: "string", enum: ["kairo", "vscode", "host_snippets", "host_codex", "host_claude_cli", "host_gemini_cli"] } },
          root: { type: "string" },
          cwd: { type: "string" },
          apply: { type: "boolean" },
          allowBroadRoot: { type: "boolean" },
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
          repoScope: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["all", "default", "repos"] },
              repoIds: { type: "array", items: { type: "string" } }
            }
          },
          repoId: { type: "string" },
          repoIds: { type: "array", items: { type: "string" } },
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
