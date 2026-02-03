import type { ToolSpec } from "./ToolSpecTypes.js";
import { SCHEMA_VERSION, DEFAULT_ADDITIONAL_PROPERTIES, CONTENT_SOURCE_SCHEMA } from "./ToolSpecRegistrySchema.js";

export const compatTools: ToolSpec[] = [
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
