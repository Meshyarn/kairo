import path from "path";
import type { TemplateContext, TemplateType } from "../../../generation/SimpleTemplateGenerator.js";
import { toPascalCase } from "./WritePillarPathUtils.js";

export const parseGenerationIntent = (intent: string, targetPath: string): { templateType: TemplateType; context: TemplateContext } | null => {
  const lowerIntent = intent.toLowerCase();
  const baseName = path.basename(targetPath, path.extname(targetPath));
  const name = extractNameFromIntent(intent, baseName);

  if (lowerIntent.includes("function") || lowerIntent.includes("func")) {
    return {
      templateType: "function",
      context: {
        name,
        params: extractParams(intent),
        returnType: extractReturnType(intent),
        export: lowerIntent.includes("export"),
        description: extractDescription(intent)
      }
    };
  }

  if (lowerIntent.includes("class")) {
    return {
      templateType: "class",
      context: {
        name: toPascalCase(name),
        export: lowerIntent.includes("export") || !lowerIntent.includes("internal"),
        description: extractDescription(intent),
        properties: [],
        methods: []
      }
    };
  }

  if (lowerIntent.includes("interface") || lowerIntent.includes("type")) {
    return {
      templateType: "interface",
      context: {
        name: toPascalCase(name),
        export: lowerIntent.includes("export") || !lowerIntent.includes("internal"),
        description: extractDescription(intent),
        properties: [],
        methods: []
      }
    };
  }

  return { templateType: "function", context: { name, export: true, description: intent } };
};

export const extractNameFromIntent = (intent: string, fallback: string): string => {
  const patterns = [
    /(?:function|class|interface)\s+([a-zA-Z_][a-zA-Z0-9_]*)/i,
    /(?:named|called)\s+([a-zA-Z_][a-zA-Z0-9_]*)/i,
    /^([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:function|class)/i
  ];
  for (const pattern of patterns) {
    const match = intent.match(pattern);
    if (match && match[1]) return match[1];
  }
  return fallback.replace(/[^a-zA-Z0-9_]/g, "") || "generated";
};

export const extractParams = (intent: string): string => {
  const match = intent.match(/(?:params?|parameters?|args?|arguments?)\s*\(([^)]+)\)/i);
  if (match && match[1]) return match[1].trim();
  const takesMatch = intent.match(/(?:takes?|accepts?)\s+([a-zA-Z0-9_,\s]+)/i);
  if (takesMatch && takesMatch[1]) {
    return takesMatch[1].split(/\s+and\s+|\s*,\s*/).map(p => p.trim()).join(", ");
  }
  return "";
};

export const extractReturnType = (intent: string): string => {
  const patterns = [/returns?\s+([a-zA-Z0-9_<>[\]]+)/i, /return\s+type\s*:\s*([a-zA-Z0-9_<>[\]]+)/i];
  for (const pattern of patterns) {
    const match = intent.match(pattern);
    if (match && match[1]) return match[1];
  }
  return "void";
};

export const extractDescription = (intent: string): string => {
  let desc = intent.replace(/^(?:create|generate|make|add|write)\s+/i, "").replace(/^(?:a|an|the)\s+/i, "").trim();
  if (desc.length > 0) desc = desc.charAt(0).toUpperCase() + desc.slice(1);
  return desc || "Auto-generated code";
};
