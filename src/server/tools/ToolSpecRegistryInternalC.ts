import type { ToolSpec } from "./ToolSpecTypes.js";
import { SCHEMA_VERSION, DEFAULT_ADDITIONAL_PROPERTIES, CONTENT_SOURCE_SCHEMA } from "./ToolSpecRegistrySchema.js";

export const ToolSpecRegistryInternalC: ToolSpec[] = [
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
