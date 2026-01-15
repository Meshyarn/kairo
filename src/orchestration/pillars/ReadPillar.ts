import crypto from 'crypto';
import { InternalToolRegistry } from '../InternalToolRegistry.js';
import { OrchestrationContext } from '../OrchestrationContext.js';
import { ParsedIntent } from '../IntentRouter.js';
import { buildDegradedReasons } from '../DegradedReasonMapper.js';
import { checkQuerySupport } from '../../ast/LanguageSupportSignals.js';
import { SyntaxValidator } from '../../engine/validators/syntax-validator.js';
import { AstManager } from '../../ast/AstManager.js';
import { getSupportForFilePath, SupportLevel } from '../../config/LanguageSupportLevels.js';
import { applyTokenBudget } from '../TokenBudget.js';
import type { FileVersionManager } from '../../engine/FileVersionManager.js';
import type { PathNormalizer } from '../../utils/PathNormalizer.js';
import { normalizeReadInput } from './read/ReadInputNormalizer.js';
import { formatReadBlockedResponse, formatReadResponse } from './read/ReadResponseFormatter.js';

export class ReadPillar {
  constructor(private readonly registry: InternalToolRegistry) {}

  public async execute(intent: ParsedIntent, context: OrchestrationContext): Promise<any> {
    const {
      constraints,
      view,
      includeProfile,
      includeHash,
      resolvedPath,
      lineRange,
      sectionId,
      headingPath,
      isDocument,
      maxTokens
    } = await normalizeReadInput(intent, {
      resolveTargetPath: (value) => this.resolveTargetPath(value),
      normalizeLineRange: (value) => this.normalizeLineRange(value),
      isDocumentPath: (value) => this.isDocumentPath(value)
    });
    const limits = constraints.limits ?? {};

    let content: string = '';
    let documentOutline: any = undefined;
    let contentSource: any = undefined;
    const reasons: string[] = [];
    let compression: {
      applied: boolean;
      mode: "none" | "truncate";
      elasticWindowPct?: number;
      maxTokens?: number;
      estimatedTokens?: number;
      maxChars?: number;
      usedChars?: number;
    } | undefined;

    if (!isDocument && view !== 'full') {
      const supportSpec = getSupportForFilePath(resolvedPath);
      if (supportSpec?.level === SupportLevel.L3) {
        const requiredQueries = supportSpec.editPolicy.requireQueries ?? [];
        if (requiredQueries.length > 0) {
          const querySupport = await checkQuerySupport(resolvedPath, requiredQueries, { required: true });
          if (querySupport.degraded) {
            const languageId = AstManager.getInstance().getLanguageId(resolvedPath);
            reasons.push(querySupport.reason ?? "missing_query_pack");
          }
        }

        if (supportSpec.editPolicy.requireSyntaxValidation && process.env.KAIRO_SKIP_PARITY_CHECK !== 'true') {
          let fullContent = '';
          try {
            const codeRead = await this.runTool(context, 'code_read', { filePath: resolvedPath, view: 'full' });
            fullContent = typeof codeRead === 'string' ? codeRead : (codeRead?.content ?? '');
          } catch {
            const degradedReasons = buildDegradedReasons(["syntax_validation_failed"], {
              filePath: resolvedPath,
              languageId: AstManager.getInstance().getLanguageId(resolvedPath)
            });
            return formatReadBlockedResponse({
              status: 'blocked',
              message: `Unable to read ${resolvedPath} for syntax validation.`,
              reasons: ["syntax_validation_failed"],
              degradedReasons
            });
          }

          const validator = new SyntaxValidator();
          const validation = await validator.validate(resolvedPath, fullContent);
          if (!validation.success) {
            const codes = (validation.blockingErrors ?? []).map((error) => error.code);
            const reason = codes.includes("SYNTAX_VALIDATOR_UNAVAILABLE")
              ? "missing_syntax_validator"
              : (codes.includes("SYNTAX_LANGUAGE_UNAVAILABLE") ? "missing_wasm_grammar" : "syntax_validation_failed");
            const degradedReasons = buildDegradedReasons([reason], {
              filePath: resolvedPath,
              languageId: validation.languageId
            });
            return formatReadBlockedResponse({
              status: 'blocked',
              message: `Syntax validation failed for ${resolvedPath}.`,
              reasons: [reason],
              degradedReasons
            });
          }
        }
      }
    }

    if (isDocument && (sectionId || headingPath)) {
      const mode = (constraints.mode ?? (view === 'full' ? 'raw' : 'preview')) as 'summary' | 'preview' | 'raw';
      const maxChars = typeof constraints.maxChars === 'number'
        ? constraints.maxChars
        : Number.parseInt(process.env.KAIRO_DOC_SECTION_MAX_CHARS ?? (mode === 'raw' ? '12000' : '4000'), 10);
      const docSection = await this.runTool(context, 'document_section', {
        filePath: resolvedPath,
        sectionId,
        headingPath,
        includeSubsections: constraints.includeSubsections === true,
        mode,
        maxChars
      });
      contentSource = docSection;
      if (Array.isArray(docSection?.reasons)) reasons.push(...docSection.reasons);
      content = docSection?.content ?? '';
      documentOutline = docSection?.section ? [docSection.section] : undefined;
    } else if (isDocument && view === 'skeleton') {
      const docSkeleton = await this.runTool(context, 'document_skeleton', {
        filePath: resolvedPath,
        options: constraints.outlineOptions
      });
      contentSource = docSkeleton;
      if (Array.isArray(docSkeleton?.reasons)) reasons.push(...docSkeleton.reasons);
      const maxChars = Number.parseInt(process.env.KAIRO_DOC_SKELETON_MAX_CHARS ?? "2000", 10);
      content = truncateText(docSkeleton?.skeleton ?? '', maxChars);
      documentOutline = docSkeleton?.outline;
    } else {
      const codeRead = await this.runTool(context, 'code_read', {
        filePath: resolvedPath,
        view,
        lineRange
      });
      contentSource = codeRead;
      if (Array.isArray(codeRead?.reasons)) reasons.push(...codeRead.reasons);
      content = typeof codeRead === 'string' ? codeRead : (codeRead?.content ?? '');
    }

    const needsFullContent = view === 'full' || includeHash;
    const includeSkeleton = view === 'skeleton';

    const [profile, skeleton, fullContent] = await Promise.all([
      this.runTool(context, 'file_profile', { filePath: resolvedPath }),
      includeSkeleton ? Promise.resolve(content) : Promise.resolve(null),
      needsFullContent
        ? (view === 'full' ? Promise.resolve(content) : this.runTool(context, 'code_read', { filePath: resolvedPath, view: 'full' }))
        : Promise.resolve(null)
    ]);

    const hashSource = typeof fullContent === 'string' ? fullContent : content;
    const hash = includeHash ? this.computeHash(hashSource) : '';
    const metadata = {
      filePath: profile?.metadata?.relativePath ?? profile?.metadata?.filePath ?? resolvedPath,
      hash,
      lineCount: profile?.metadata?.lineCount ?? (typeof fullContent === 'string' ? fullContent.split(/\r?\n/).length : (typeof content === 'string' ? content.split(/\r?\n/).length : 0)),
      language: profile?.metadata?.language ?? null
    };
    const fileVersionManager = this.registry.getMetadata<FileVersionManager>('fileVersionManager');
    const pathNormalizer = this.registry.getMetadata<PathNormalizer>('pathNormalizer');
    if (fileVersionManager && pathNormalizer) {
      try {
        const absPath = pathNormalizer.toAbsolute(pathNormalizer.normalize(metadata.filePath));
        const versionInfo = await fileVersionManager.getVersion(absPath);
        (metadata as any).versionInfo = versionInfo;
      } catch {
        // ignore versionInfo failures
      }
    }

    const tokenBudget = applyTokenBudget(content, {
      maxTokens,
      maxChars: typeof constraints.maxChars === 'number' ? constraints.maxChars : undefined,
      languageId: metadata.language ?? undefined
    });
    if (tokenBudget.applied) {
      content = tokenBudget.text;
      reasons.push('budget_exceeded');
      compression = {
        applied: true,
        mode: tokenBudget.mode,
        elasticWindowPct: tokenBudget.elasticWindowPct,
        maxTokens: tokenBudget.maxTokens,
        estimatedTokens: tokenBudget.estimatedTokens,
        maxChars: tokenBudget.maxChars,
        usedChars: tokenBudget.usedChars
      };
    }

    const degradedReasons = buildDegradedReasons(reasons.length > 0 ? reasons : undefined, {
      filePath: metadata.filePath,
      languageId: metadata.language ?? undefined
    });

    return formatReadResponse({
      success: true,
      status: 'success',
      content,
      metadata,
      profile: includeProfile ? (profile ?? undefined) : undefined,
      skeleton: typeof skeleton === 'string' ? skeleton : undefined,
      document: documentOutline ? { outline: documentOutline } : undefined,
      degraded: Boolean(contentSource?.degraded) || Boolean(tokenBudget.applied),
      degradedReasons,
      compression,
      guidance: {
        message: view === 'full'
          ? 'Full content loaded.'
          : 'Content loaded. Use view="full" or includeProfile/includeHash for more detail.',
        suggestedActions: view === 'full'
          ? []
          : [
              {
                id: 'read.view_full',
                priority: 1,
                description: 'Load full content for this file.',
                rationale: 'Full content provides complete context.',
                toolCall: { tool: 'read', args: { action: 'view_full', target: resolvedPath } }
              },
              {
                id: 'read.include_profile',
                priority: 2,
                description: 'Include file profile metadata.',
                rationale: 'Profile metadata helps guide deeper analysis.',
                toolCall: {
                  tool: 'read',
                  args: { action: 'include_profile', target: resolvedPath, options: { includeProfile: true } }
                }
              }
            ]
      }
    });
  }

  private async resolveTargetPath(target: string): Promise<string> {
    if (this.looksLikePath(target)) {
      if (!/[\\/]/.test(target)) {
        const filenameMatch = await this.registry.execute('project_search', { query: target, type: 'filename', maxResults: 1 });
        if (filenameMatch?.results?.length > 0) {
          return filenameMatch.results[0].path;
        }
      }
      return target;
    }
    const symbolMatch = await this.registry.execute('project_search', { query: target, type: 'symbol', maxResults: 1 });
    if (symbolMatch?.results?.length > 0) {
      return symbolMatch.results[0].path;
    }
    const fileMatch = await this.registry.execute('project_search', { query: target, type: 'file', maxResults: 1 });
    if (fileMatch?.results?.length > 0) {
      return fileMatch.results[0].path;
    }
    return target;
  }

  private looksLikePath(target: string): boolean {
    return /[\\/]/.test(target) || /\.[a-z0-9]+$/i.test(target);
  }

  private isDocumentPath(target: string): boolean {
    return /\.(md|mdx|txt|log|docx|xlsx|pdf)$/i.test(target);
  }

  private normalizeLineRange(raw?: string | [number, number]): string | undefined {
    if (!raw) return undefined;
    if (Array.isArray(raw) && raw.length === 2) {
      return `${raw[0]}-${raw[1]}`;
    }
    return raw;
  }

  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content ?? '').digest('hex');
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
}

function truncateText(text: string, maxChars: number): string {
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 2000;
  const value = String(text ?? "");
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(1, limit - 1))}…`;
}
