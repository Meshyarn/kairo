import type { HandlerContext } from "../HandlerContext.js";

export async function executeImpactAnalyzer(args: any, context: HandlerContext) {
  const targetPath = args?.target ?? args?.filePath ?? args?.path;
  if (!targetPath) {
    return { success: false, message: "target is required for impact analysis." };
  }
  const edits = Array.isArray(args?.edits) ? args.edits : [];
  const absPath = context.pathNormalizer.toAbsolute(context.pathNormalizer.normalize(targetPath));
  return context.impactAnalyzer.analyzeImpact(absPath, edits);
}
