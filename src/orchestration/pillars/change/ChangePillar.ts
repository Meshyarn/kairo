import { InternalToolRegistry } from '../../InternalToolRegistry.js';
import { OrchestrationContext } from '../../OrchestrationContext.js';
import { ParsedIntent } from '../../IntentRouter.js';
import { EditResolver } from '../../../engine/EditResolver.js';
import { EditCoordinator } from '../../../engine/EditCoordinator.js';
import { EditorEngine } from '../../../engine/Editor.js';
import { HistoryEngine } from '../../../engine/History.js';
import { NodeFileSystem, type IFileSystem } from '../../../platform/FileSystem.js';
import { resolveEnvelopeMaxTokens } from "../../policy/McpModePresetRegistry.js";
import {
  evaluateLanguageParityGate,
  formatParityBlockMessage
} from "../../../config/LanguageParityGate.js";
import { executeChangePillar } from "./ChangePillarExecution.js";
import { findFallbackConsumers, buildCrossLangImpact as buildCrossLangImpactImpl } from "./ChangePillarContractImpact.js";

export class ChangePillar {
  private fileSystem?: IFileSystem;
  
  constructor(private readonly registry: InternalToolRegistry) {}

  private resolveRootPath(): string {
    const injected =
      typeof this.registry.getMetadata === "function"
        ? this.registry.getMetadata("rootPath") as string | undefined
        : undefined;
    return typeof injected === "string" && injected.length > 0 ? injected : process.cwd();
  }

  private resolveFileSystem(): IFileSystem {
    if (this.fileSystem) return this.fileSystem;
    const injected =
      typeof this.registry.getMetadata === "function"
        ? this.registry.getMetadata("fileSystem") as IFileSystem | undefined
        : undefined;
    this.fileSystem = injected ?? new NodeFileSystem(this.resolveRootPath());
    return this.fileSystem;
  }

  private getEditCoordinator(): EditCoordinator {
    const rootPath = this.resolveRootPath();
    const fileSystem = this.resolveFileSystem();
    const editorEngine = new EditorEngine(rootPath, fileSystem);
    const historyEngine = new HistoryEngine(rootPath, fileSystem);
    return new EditCoordinator(editorEngine, historyEngine);
  }

  private getEditResolver(): EditResolver {
    const rootPath = this.resolveRootPath();
    const fileSystem = this.resolveFileSystem();
    const editorEngine = new EditorEngine(rootPath, fileSystem);
    return new EditResolver(fileSystem, editorEngine);
  }

  public async execute(intent: ParsedIntent, context: OrchestrationContext): Promise<any> {
    return executeChangePillar({
      registry: this.registry,
      resolveRootPath: () => this.resolveRootPath(),
      resolveFileSystem: () => this.resolveFileSystem(),
      getEditCoordinator: () => this.getEditCoordinator(),
      getEditResolver: () => this.getEditResolver(),
      runTool: (ctx, tool, args) => this.runTool(ctx, tool, args),
      resolveTargetFiles: (constraints, targets) => this.resolveTargetFiles(constraints, targets),
      resolveEnvelopeBudget: (constraints) => this.resolveEnvelopeBudget(constraints),
      resolveParityGate: (targetPath, operation) => this.resolveParityGate(targetPath, operation),
      buildSchemaCoaching: (args) => this.buildSchemaCoaching(args),
      shouldUseBatch: (constraints, targetFiles, editPaths) => this.shouldUseBatch(constraints, targetFiles, editPaths),
      buildCrossLangImpact: (targetPath, ctx, options) => this.buildCrossLangImpact(targetPath, ctx, options)
    }, intent, context);
  }

  public async findFallbackConsumers(
    context: OrchestrationContext,
    packageName: string,
    entryPath: string
  ): Promise<string[]> {
    return findFallbackConsumers({
      context,
      packageName,
      entryPath,
      runTool: (ctx, tool, args) => this.runTool(ctx, tool, args),
      fileSystem: this.resolveFileSystem()
    });
  }

  public async buildCrossLangImpact(
    targetPath: string,
    context: OrchestrationContext,
    options?: { force?: boolean; changedExports?: string[]; afterContent?: string }
  ): Promise<any> {
    return buildCrossLangImpactImpl({
      targetPath,
      context,
      registry: this.registry,
      rootPath: this.resolveRootPath(),
      fileSystem: this.resolveFileSystem(),
      runTool: (ctx, tool, args) => this.runTool(ctx, tool, args),
      options
    });
  }

  private async runTool(context: OrchestrationContext, tool: string, args: any) {
    const started = Date.now();
    const output = await this.registry.execute(tool, args);
    context.addStep({
      id: `${tool}_${context.getFullHistory().length + 1}`,
      tool,
      args,
      output,
      status: output?.success === false || output?.isError ? "failure" : "success",
      duration: Date.now() - started
    });
    return output;
  }

  private resolveTargetFiles(constraints: any, targets: string[]): string[] {
    const fromConstraints = Array.isArray(constraints?.targetFiles) ? constraints.targetFiles : [];
    return (fromConstraints.length > 0 ? fromConstraints : targets).filter((t: any) => typeof t === 'string');
  }

  private resolveEnvelopeBudget(constraints: any): { maxTokens?: number; maxChars?: number } {
    const limits = constraints?.limits ?? {};
    const policyMaxTokens = resolveEnvelopeMaxTokens("change");
    const maxTokens = Number.isFinite(limits.maxTokens) && limits.maxTokens > 0
      ? limits.maxTokens
      : policyMaxTokens;
    const maxChars = Number.isFinite(limits.maxChars) && limits.maxChars > 0
      ? limits.maxChars
      : undefined;
    return {
      maxTokens: Number.isFinite(maxTokens) ? maxTokens : undefined,
      maxChars: Number.isFinite(maxChars) ? maxChars : undefined
    };
  }

  private async resolveParityGate(
    targetPath: string,
    operation: "change_plan" | "change_apply"
  ): Promise<{ blocked: boolean; message?: string; result: Awaited<ReturnType<typeof evaluateLanguageParityGate>> }> {
    const result = await evaluateLanguageParityGate({ filePath: targetPath, operation });
    const blocked = result.outcome === "block";
    const message = result.reasons.length > 0 ? formatParityBlockMessage({ filePath: targetPath, result }) : undefined;
    return { blocked, message, result };
  }

  private buildSchemaCoaching(args: { errorCode: string; targetPath?: string; intent?: string }) {
    return {
      errorCode: args.errorCode,
      retryable: true,
      nextAttemptHints: [
        "Provide edits with targetString and replacementString.",
        "Use read to capture exact target text before retry."
      ],
      requiredFields: ["edits[].targetString", "edits[].replacementString"],
      unknownFields: [],
      editsTemplate: {
        edits: [
          {
            targetString: "<exact text>",
            replacementString: "<replacement>"
          }
        ]
      },
      schemaExample: {
        edits: [
          {
            targetString: "old",
            replacementString: "new"
          }
        ]
      },
      helpUrl: "docs/guides/getting-started.md",
      targetPath: args.targetPath,
      intent: args.intent
    };
  }

  private shouldUseBatch(constraints: any, targetFiles: string[], editPaths: string[]): boolean {
    return Boolean(constraints?.batchMode) || targetFiles.length > 1 || editPaths.length > 1;
  }

}
