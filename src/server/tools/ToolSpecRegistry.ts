import type { ToolSpec } from "./ToolSpecTypes.js";
import { pillarTools } from "./ToolSpecRegistryPillar.js";

export type { ToolSchemaVersion, ToolSchemaMode, ToolVisibility, ToolSpec } from "./ToolSpecTypes.js";

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

export function createDefaultToolSpecRegistry(): ToolSpecRegistry {
  return new ToolSpecRegistry([...pillarTools]);
}
