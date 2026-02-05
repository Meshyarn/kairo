import type { ToolSpec } from "./ToolSpecTypes.js";
import { SCHEMA_VERSION, DEFAULT_ADDITIONAL_PROPERTIES, CONTENT_SOURCE_SCHEMA } from "./ToolSpecRegistrySchema.js";

export const ToolSpecRegistryPillarA: ToolSpec[] = [
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
          verifyExec: {
            type: "object",
            properties: {
              enabled: { type: "boolean" },
              ids: { type: "array", items: { type: "string" } }
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
          edits: {
            type: "array",
            items: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                operation: { type: "string" },
                targetString: { type: "string" },
                replacementString: { type: "string" },
                targetSource: CONTENT_SOURCE_SCHEMA,
                replacementSource: CONTENT_SOURCE_SCHEMA
              }
            }
          },
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
    }
];
