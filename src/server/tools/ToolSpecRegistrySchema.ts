import type { ToolSchemaVersion } from "./ToolSpecTypes.js";

export const SCHEMA_VERSION: ToolSchemaVersion = "2026-01-12";

export const DEFAULT_ADDITIONAL_PROPERTIES = false;

export const CONTENT_SOURCE_SCHEMA = {
  anyOf: [
    {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["inline"] },
        text: { type: "string" }
      },
      required: ["kind", "text"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["base64"] },
        base64: { type: "string" },
        charset: { type: "string", enum: ["utf8"] }
      },
      required: ["kind", "base64"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["file"] },
        path: { type: "string" }
      },
      required: ["kind", "path"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["artifact"] },
        id: { type: "string" }
      },
      required: ["kind", "id"],
      additionalProperties: false
    }
  ]
};
