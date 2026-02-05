import type { InternalToolRegistry } from "../../InternalToolRegistry.js";

export const looksLikePath = (value: string): boolean => (
  /[\\/]/.test(value) || /\.[a-z0-9]+$/i.test(value)
);

export const toPascalCase = (value: string): string => (
  value
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
);

export const resolveTargetPath = async (
  registry: InternalToolRegistry,
  targetPath: string
): Promise<string> => {
  if (!looksLikePath(targetPath)) return targetPath;
  if (!/[\\/]/.test(targetPath)) {
    const filenameMatch = await registry.execute("project_search", { query: targetPath, type: "filename", maxResults: 1 });
    if (filenameMatch?.results?.length > 0) return filenameMatch.results[0].path;
  }
  return targetPath;
};
