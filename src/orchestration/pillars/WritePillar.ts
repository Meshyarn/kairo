import crypto from 'crypto';
import { InternalToolRegistry } from '../InternalToolRegistry.js';
import { OrchestrationContext } from '../OrchestrationContext.js';
import { ParsedIntent } from '../IntentRouter.js';
import { NodeFileSystem, type IFileSystem } from '../../platform/FileSystem.js';
import { buildDegradedReasons } from "../DegradedReasonMapper.js";
import { resolveEnvelopeMaxTokens } from "../policy/McpModePresetRegistry.js";
import { applyFormatterBridge } from "../formatter/FormatterBridge.js";
import { executeWritePillar } from "./write/WritePillarExecution.js";
import { parseGenerationIntent, extractParams, extractReturnType, extractDescription } from "./write/WritePillarGenerationUtils.js";

export class WritePillar {
  private fileSystem?: IFileSystem;

  constructor(private readonly registry: InternalToolRegistry) {}

  private resolveRootPath(): string {
    const injected =
      typeof this.registry.getMetadata === "function"
        ? this.registry.getMetadata<string>("rootPath")
        : undefined;
    return typeof injected === "string" && injected.length > 0 ? injected : process.cwd();
  }

  private computeHash(content: string): { algorithm: 'xxhash' | 'sha256'; value: string } {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return { algorithm: 'sha256', value: hash };
  }

  private resolveFileSystem(): IFileSystem {
    if (this.fileSystem) return this.fileSystem;
    const injected =
      typeof this.registry.getMetadata === "function"
        ? this.registry.getMetadata<IFileSystem>("fileSystem")
        : undefined;
    this.fileSystem = injected ?? new NodeFileSystem(this.resolveRootPath());
    return this.fileSystem;
  }

  private resolveEnvelopeBudget(constraints: any): { maxTokens?: number; maxChars?: number } {
    const limits = constraints?.limits ?? {};
    const policyMaxTokens = resolveEnvelopeMaxTokens("write");
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

  private resolveFormatterMode(constraints: any): string | undefined {
    if (typeof constraints?.formatter === "string") return constraints.formatter;
    if (typeof constraints?.options?.formatter === "string") return constraints.options.formatter;
    return undefined;
  }

  private async applyFormatterIfNeeded(
    mode: string | undefined,
    filePath: string,
    rollbackAvailable?: boolean
  ): Promise<Awaited<ReturnType<typeof applyFormatterBridge>> | undefined> {
    if (!mode) return undefined;
    const fileSystem = this.resolveFileSystem();
    return applyFormatterBridge({
      mode,
      filePaths: [filePath],
      rootPath: this.resolveRootPath(),
      fileSystem,
      tool: "write",
      rollbackAvailable
    });
  }

  private applyFormatterOutcome<T extends Record<string, any>>(
    payload: T,
    formatterResult: Awaited<ReturnType<typeof applyFormatterBridge>> | undefined,
    filePath: string
  ): T {
    if (!formatterResult) return payload;
    const formatterReasons = formatterResult.degradedReasons?.length
      ? buildDegradedReasons(formatterResult.degradedReasons, { filePath })
      : [];
    const existingReasons = Array.isArray(payload.degradedReasons) ? payload.degradedReasons : [];
    const mergedReasons = formatterReasons && formatterReasons.length > 0
      ? [...existingReasons, ...formatterReasons]
      : existingReasons;
    const guidance = payload.guidance ?? {};
    const mergedActions = formatterResult.suggestedActions?.length
      ? [
          ...(Array.isArray(guidance.suggestedActions) ? guidance.suggestedActions : []),
          ...formatterResult.suggestedActions
        ]
      : guidance.suggestedActions;
    return {
      ...payload,
      formatter: formatterResult,
      guidance: {
        ...guidance,
        ...(mergedActions ? { suggestedActions: mergedActions } : {})
      },
      ...(mergedReasons.length > 0
        ? { degraded: Boolean(payload.degraded) || true, degradedReasons: mergedReasons }
        : {})
    };
  }


  public async execute(intent: ParsedIntent, context: OrchestrationContext): Promise<any> {
    return executeWritePillar({
      registry: this.registry,
      resolveRootPath: () => this.resolveRootPath(),
      resolveFileSystem: () => this.resolveFileSystem(),
      resolveEnvelopeBudget: (constraints) => this.resolveEnvelopeBudget(constraints),
      resolveFormatterMode: (constraints) => this.resolveFormatterMode(constraints),
      applyFormatterIfNeeded: (mode, filePath, rollbackAvailable) =>
        this.applyFormatterIfNeeded(mode, filePath, rollbackAvailable),
      applyFormatterOutcome: (payload, formatterResult, filePath) =>
        this.applyFormatterOutcome(payload, formatterResult, filePath),
      computeHash: (value) => this.computeHash(value),
      runTool: (ctx, tool, args) => this.runTool(ctx, tool, args)
    }, intent, context);
  }

  private async runTool(context: OrchestrationContext, tool: string, args: any) {
    const started = Date.now();
    const output = await this.registry.execute(tool, args);
    context.addStep({
      id: `${tool}_${context.getFullHistory().length + 1}`,
      tool,
      args,
      output,
      status: output?.success === false || output?.isError ? 'failure' : 'success',
      duration: Date.now() - started
    });
    return output;
  }

  public parseGenerationIntent(intent: string, targetPath: string) {
    return parseGenerationIntent(intent, targetPath);
  }

  public extractParams(intent: string): string {
    return extractParams(intent);
  }

  public extractReturnType(intent: string): string {
    return extractReturnType(intent);
  }

  public extractDescription(intent: string): string {
    return extractDescription(intent);
  }

}
