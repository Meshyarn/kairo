import { BaseHandler } from "../BaseHandler.js";
import type { HandlerContext } from "../HandlerContext.js";

export class KairoImpactHandler extends BaseHandler {
  private context: HandlerContext;

  constructor(context: HandlerContext) {
    super(context.toolSpecRegistry);
    this.context = context;
  }

  async handle(name: string, args: any): Promise<any> {
    if (name !== "kairo_impact") return null;

    const missing = this.validateRequiredArgs(name, args);
    if (missing.length > 0) {
      return this.errorResponse(
        "MissingParameter",
        `Missing: ${missing.join(", ")}`,
      );
    }

    const { target, depth = "shallow", includeTests = false } = args;
    const maxDepth = depth === "deep" ? 5 : 2;

    try {
      // Determine if target is a file path or symbol name
      const isFilePath = target.includes("/") || target.includes("\\");

      if (isFilePath) {
        return await this.analyzeFilePath(target, includeTests);
      } else {
        return await this.analyzeSymbol(target, maxDepth, includeTests);
      }
    } catch (error: any) {
      return this.errorResponse(
        "ImpactAnalysisError",
        error?.message ?? "Impact analysis failed",
      );
    }
  }

  private async analyzeFilePath(
    filePath: string,
    includeTests: boolean,
  ): Promise<any> {
    const impact = await this.context.impactAnalyzer.analyzeImpact(
      filePath,
      [],
    );

    return this.jsonResponse(this.formatImpactResult(impact, includeTests));
  }

  private async analyzeSymbol(
    symbolName: string,
    maxDepth: number,
    includeTests: boolean,
  ): Promise<any> {
    const graph = await this.context.callGraphBuilder.analyzeSymbol(
      symbolName,
      "",
      "both",
      maxDepth,
    );

    if (!graph) {
      return this.jsonResponse({
        target: symbolName,
        directRefs: [],
        transitiveImpact: [],
        riskLevel: "unknown",
      });
    }

    return this.jsonResponse(
      this.formatGraphImpact(graph, symbolName, includeTests),
    );
  }

  private formatImpactResult(impact: any, includeTests: boolean): any {
    const directRefs: Array<{
      file: string;
      symbol: string;
      line: number;
    }> = [];
    const transitiveImpact: Array<{
      file: string;
      depth: number;
      reason: string;
    }> = [];

    // Extract affected files from impact result
    const affectedFiles =
      impact?.affectedFiles ?? impact?.impactedFiles ?? [];
    for (const file of affectedFiles) {
      const filePath = file.filePath ?? file.path ?? file;
      if (!includeTests && this.isTestFile(filePath)) continue;

      if (file.depth === 1 || file.isDirect) {
        directRefs.push({
          file: filePath,
          symbol: file.symbol ?? file.name ?? "",
          line: file.line ?? file.lineNumber ?? 0,
        });
      } else {
        transitiveImpact.push({
          file: filePath,
          depth: file.depth ?? 2,
          reason: file.reason ?? "transitive dependency",
        });
      }
    }

    const riskLevel = this.calculateRiskLevel(
      directRefs.length,
      transitiveImpact.length,
    );

    return {
      target: impact?.filePath ?? impact?.target ?? "",
      riskLevel,
      directRefs,
      transitiveImpact,
    };
  }

  private formatGraphImpact(
    graph: any,
    symbolName: string,
    includeTests: boolean,
  ): any {
    const directRefs: Array<{
      file: string;
      symbol: string;
      line: number;
    }> = [];
    const transitiveImpact: Array<{
      file: string;
      depth: number;
      reason: string;
    }> = [];

    const visitedNodes = graph.visitedNodes ?? {};
    for (const node of Object.values(visitedNodes) as any[]) {
      const filePath = node.filePath ?? node.file ?? "";
      if (!includeTests && this.isTestFile(filePath)) continue;

      if (node.depth === 1) {
        directRefs.push({
          file: filePath,
          symbol: node.symbolName ?? node.name ?? "",
          line: node.lineNumber ?? 0,
        });
      } else if (node.depth > 1) {
        transitiveImpact.push({
          file: filePath,
          depth: node.depth,
          reason: `${node.symbolType ?? "symbol"}: ${node.symbolName ?? ""}`,
        });
      }
    }

    const riskLevel = this.calculateRiskLevel(
      directRefs.length,
      transitiveImpact.length,
    );

    return {
      target: symbolName,
      riskLevel,
      directRefs,
      transitiveImpact,
    };
  }

  private calculateRiskLevel(
    directCount: number,
    transitiveCount: number,
  ): "low" | "medium" | "high" | "unknown" {
    const total = directCount + transitiveCount;
    if (total === 0) return "unknown";
    if (total <= 3) return "low";
    if (total <= 10) return "medium";
    return "high";
  }

  private isTestFile(filePath: string): boolean {
    return /\.(test|spec|__tests__)\b/i.test(filePath);
  }
}
