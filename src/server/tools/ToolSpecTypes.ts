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
