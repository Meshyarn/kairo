import crypto from 'crypto';
import path from 'path';
import { InternalToolRegistry } from '../InternalToolRegistry.js';
import { OrchestrationContext } from '../OrchestrationContext.js';
import { ParsedIntent } from '../IntentRouter.js';
import { metrics } from '../../utils/MetricsCollector.js';
import { type TemplateType, type TemplateContext } from '../../generation/SimpleTemplateGenerator.js';

import {
    smartWriteCode,
    quickGenerateCode,
    resolveTemplateContent
} from "./write/CodeGeneration.js";
import {
    evaluateIntegrityGuardrails,
    normalizeGuardrailContent,
    resolveGuardrailTargetPath
} from "../guardrails/IntegrityGuardrails.js";
import type { DependencyGraph } from "../../ast/DependencyGraph.js";
import type { IndexStateManager } from "../../indexing/IndexStateManager.js";

export class WritePillar {
  constructor(private readonly registry: InternalToolRegistry) {}

  private computeHash(content: string): { algorithm: 'xxhash' | 'sha256'; value: string } {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return { algorithm: 'sha256', value: hash };
  }


  public async execute(intent: ParsedIntent, context: OrchestrationContext): Promise<any> {
    const stopTotal = metrics.startTimer("write.total_ms");
    try {
      const { constraints, targets, originalIntent } = intent;
      const targetPath = constraints.targetPath || targets[0];
      const template = constraints.template;
      let content = constraints.content ?? '';
      const hasExplicitContent = constraints.content !== undefined;
      const safeWrite = Boolean((constraints as any).safeWrite);
      
      const quickGenerate = Boolean((constraints as any).quickGenerate);
      const smartWrite = Boolean((constraints as any).smartWrite);
      const styleReference = (constraints as any).styleReference as string[] | undefined;

      if (!targetPath) {
        return {
          success: false,
          status: 'failure',
          createdFiles: [],
          transactionId: null,
          guidance: {
            message: 'Missing targetPath. Provide a file path to create.',
            suggestedActions: []
          }
        };
      }

      const resolvedPath = await this.resolveTargetPath(targetPath);

      if (smartWrite && !hasExplicitContent) {
        const stopSmartWrite = metrics.startTimer("write.smart_write_ms");
        try {
          const generated = await smartWriteCode(
            resolvedPath,
            originalIntent,
            constraints,
            context,
            (ctx, tool, args) => this.runTool(ctx, tool, args),
            (i, p) => this.parseGenerationIntent(i, p),
            styleReference
          );
          stopSmartWrite();
          
          if (generated) {
            content = generated.code;
            return await this.writeGeneratedCode(resolvedPath, content, originalIntent, context, generated.templateType, generated.imports, constraints);
          }
        } catch (error: any) {
          stopSmartWrite();
          console.warn(`Smart write failed: ${error.message}, falling back to quickGenerate`);
        }
      }

      if ((quickGenerate || smartWrite) && !hasExplicitContent) {
        const stopGenerate = metrics.startTimer("write.quick_generate_ms");
        try {
          const generated = await quickGenerateCode(resolvedPath, originalIntent, (i, p) => this.parseGenerationIntent(i, p));
          stopGenerate();
          if (generated) {
            content = generated.code;
            return await this.writeGeneratedCode(resolvedPath, content, originalIntent, context, generated.templateType, undefined, constraints);
          }
        } catch (error: any) {
          stopGenerate();
          console.warn(`Quick generate failed: ${error.message}`);
        }
      }

      if (hasExplicitContent && safeWrite) {
        const stopSafePatch = metrics.startTimer("write.safe_patch_ms");
        try {
          let existingContent = '';
          try {
            existingContent = await this.runTool(context, 'code_read', { filePath: resolvedPath, view: 'full' });
          } catch {
            try {
              await this.runTool(context, 'file_write', { filePath: resolvedPath, content: '' });
            } catch {
              await this.runTool(context, 'edit_apply', {
                edits: [{ filePath: resolvedPath, operation: 'create', replacementString: '' }],
                dryRun: false,
                createMissingDirectories: true
              });
            }
            existingContent = '';
          }

          const guardrailResult = await this.evaluateGuardrails(
            context,
            resolvedPath,
            existingContent,
            content,
            constraints
          );
          if (guardrailResult?.status === 'block') {
            stopSafePatch();
            return {
              success: false,
              status: 'blocked',
              createdFiles: [],
              transactionId: '',
              rollbackAvailable: false,
              writeMode: 'safe',
              architecturalRisk: guardrailResult.architecturalRisk,
              architecturalWarnings: guardrailResult.architecturalWarnings,
              safetyChecklist: guardrailResult.safetyChecklist,
              blockingErrors: guardrailResult.blockingErrors,
              errorCode: guardrailResult.errorCode ?? 'ARCHITECTURE_BLOCKED',
              blockedReason: guardrailResult.blockedReason ?? 'architectural_violation',
              violations: guardrailResult.violations,
              warnings: guardrailResult.warnings,
              guidance: {
                message: guardrailResult.violations?.[0]?.message ?? 'Write blocked by integrity guardrails.'
              }
            };
          }

          const edit = {
            targetString: existingContent,
            replacementString: content,
            indexRange: { start: 0, end: existingContent.length },
            expectedHash: existingContent ? this.computeHash(existingContent) : undefined
          };

          const result = await this.runTool(context, 'edit_transaction', {
            filePath: resolvedPath,
            edits: [edit],
            dryRun: false
          });

          stopSafePatch();

          return {
            success: result.success ?? true,
            status: result.success === false ? 'failure' : 'success',
            createdFiles: result.success ? [{ path: resolvedPath, description: `Written (safe mode) from intent: ${originalIntent}` }] : [],
            transactionId: result.operation?.id || '',
            rollbackAvailable: true,
            writeMode: 'safe',
            architecturalRisk: guardrailResult?.architecturalRisk,
            architecturalWarnings: guardrailResult?.architecturalWarnings,
            safetyChecklist: guardrailResult?.safetyChecklist,
            blockingErrors: guardrailResult?.blockingErrors,
            errorCode: guardrailResult?.errorCode,
            blockedReason: guardrailResult?.blockedReason,
            violations: guardrailResult?.violations,
            warnings: guardrailResult?.warnings,
            guidance: {
              message: result.success ? 'File written with undo support.' : `Write failed: ${result.message || 'Unknown error'}`,
              suggestedActions: result.success ? [{ pillar: 'read', action: 'view_full', target: resolvedPath }] : []
            }
          };
        } catch (error: any) {
          stopSafePatch();
          return {
            success: false,
            status: 'failure',
            createdFiles: [],
            transactionId: '',
            rollbackAvailable: false,
            writeMode: 'safe',
            guidance: { message: `Safe write failed: ${error.message}`, suggestedActions: [] }
          };
        }
      }

      if (hasExplicitContent && !safeWrite) {
        let existingContent = '';
        try {
          existingContent = await this.runTool(context, 'code_read', { filePath: resolvedPath, view: 'full' });
        } catch {
          existingContent = '';
        }
        const guardrailResult = await this.evaluateGuardrails(
          context,
          resolvedPath,
          existingContent,
          content,
          constraints
        );
        if (guardrailResult?.status === 'block') {
          return {
            success: false,
            status: 'blocked',
            createdFiles: [],
            transactionId: '',
            rollbackAvailable: false,
            writeMode: 'fast',
            architecturalRisk: guardrailResult.architecturalRisk,
            architecturalWarnings: guardrailResult.architecturalWarnings,
            safetyChecklist: guardrailResult.safetyChecklist,
            blockingErrors: guardrailResult.blockingErrors,
            errorCode: guardrailResult.errorCode ?? 'ARCHITECTURE_BLOCKED',
            blockedReason: guardrailResult.blockedReason ?? 'architectural_violation',
            violations: guardrailResult.violations,
            warnings: guardrailResult.warnings,
            guidance: {
              message: guardrailResult.violations?.[0]?.message ?? 'Write blocked by integrity guardrails.'
            }
          };
        }

        try {
          await this.runTool(context, 'file_write', { filePath: resolvedPath, content });
        } catch {
          await this.runTool(context, 'edit_apply', {
            edits: [{ filePath: resolvedPath, operation: 'create', replacementString: content }],
            dryRun: false,
            createMissingDirectories: true
          });
        }

        return {
          success: true,
          status: 'success',
          createdFiles: [{ path: resolvedPath, description: `Written from intent: ${originalIntent}` }],
          transactionId: '',
          rollbackAvailable: false,
          writeMode: 'fast',
          architecturalRisk: guardrailResult?.architecturalRisk,
          architecturalWarnings: guardrailResult?.architecturalWarnings,
          safetyChecklist: guardrailResult?.safetyChecklist,
          blockingErrors: guardrailResult?.blockingErrors,
          errorCode: guardrailResult?.errorCode,
          blockedReason: guardrailResult?.blockedReason,
          violations: guardrailResult?.violations,
          warnings: guardrailResult?.warnings,
          guidance: {
            message: 'File written (fast mode, no undo).',
            suggestedActions: [{ pillar: 'read', action: 'view_full', target: resolvedPath }]
          }
        };
      }

      let existingContent: string | null = null;
      try {
        existingContent = await this.runTool(context, 'code_read', { filePath: resolvedPath, view: 'full' });
      } catch {
        existingContent = null;
      }

      if (existingContent === null) {
        try {
          await this.runTool(context, 'file_write', { filePath: resolvedPath, content: '' });
        } catch {
          await this.runTool(context, 'edit_apply', {
            edits: [{ filePath: resolvedPath, operation: 'create', replacementString: '' }],
            dryRun: false,
            createMissingDirectories: true
          });
        }
      }

      if (content === '' && template) {
        const templated = await resolveTemplateContent(template, resolvedPath, originalIntent, context, (ctx, tool, args) => this.runTool(ctx, tool, args), (v) => this.toPascalCase(v), (v) => this.looksLikePath(v));
        if (typeof templated === 'string') {
          content = templated;
        }
      }

      if (content === '' && existingContent === null) {
        return {
          success: true,
          status: 'success',
          createdFiles: [{ path: resolvedPath, description: `Created from intent: ${originalIntent}` }],
          transactionId: null,
          guidance: {
            message: 'Empty file created.',
            suggestedActions: [{ pillar: 'read', action: 'view_full', target: resolvedPath }]
          }
        };
      }

      const edit = existingContent === null
        ? { targetString: '', replacementString: content, insertMode: 'at' as const, insertLineRange: { start: 1 } }
        : { targetString: existingContent, replacementString: content };

      const guardrailResult = await this.evaluateGuardrails(
        context,
        resolvedPath,
        existingContent ?? '',
        content,
        constraints
      );
      if (guardrailResult?.status === 'block') {
        return {
          success: false,
          status: 'blocked',
          createdFiles: [],
          transactionId: '',
          rollbackAvailable: false,
          writeMode: 'safe',
          architecturalRisk: guardrailResult.architecturalRisk,
          architecturalWarnings: guardrailResult.architecturalWarnings,
          safetyChecklist: guardrailResult.safetyChecklist,
          blockingErrors: guardrailResult.blockingErrors,
          errorCode: guardrailResult.errorCode ?? 'ARCHITECTURE_BLOCKED',
          blockedReason: guardrailResult.blockedReason ?? 'architectural_violation',
          violations: guardrailResult.violations,
          warnings: guardrailResult.warnings,
          guidance: {
            message: guardrailResult.violations?.[0]?.message ?? 'Write blocked by integrity guardrails.'
          }
        };
      }

      const editResult = await this.runTool(context, 'edit_transaction', {
        filePath: resolvedPath,
        edits: [edit],
        dryRun: false
      });

      return {
        success: editResult.success ?? true,
        status: editResult.success === false ? 'failure' : 'success',
        createdFiles: [{ path: resolvedPath, description: `Written from intent: ${originalIntent}` }],
        transactionId: editResult.operation?.id ?? '',
        architecturalRisk: guardrailResult?.architecturalRisk,
        architecturalWarnings: guardrailResult?.architecturalWarnings,
        safetyChecklist: guardrailResult?.safetyChecklist,
        blockingErrors: guardrailResult?.blockingErrors,
        errorCode: guardrailResult?.errorCode,
        blockedReason: guardrailResult?.blockedReason,
        violations: guardrailResult?.violations,
        warnings: guardrailResult?.warnings,
        guidance: {
          message: editResult.success ? 'File written.' : 'File write failed.',
          suggestedActions: editResult.success ? [{ pillar: 'read', action: 'view_full', target: resolvedPath }] : []
        }
      };
    } finally {
      stopTotal();
    }
  }

  private async resolveTargetPath(targetPath: string): Promise<string> {
    if (!this.looksLikePath(targetPath)) return targetPath;
    if (!/[\\/]/.test(targetPath)) {
      const filenameMatch = await this.registry.execute('project_search', { query: targetPath, type: 'filename', maxResults: 1 });
      if (filenameMatch?.results?.length > 0) return filenameMatch.results[0].path;
    }
    return targetPath;
  }

  private looksLikePath(value: string): boolean {
    return /[\\/]/.test(value) || /\.[a-z0-9]+$/i.test(value);
  }

  private toPascalCase(value: string): string {
    return value
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }

  private async evaluateGuardrails(
    context: OrchestrationContext,
    targetPath: string,
    oldContent: string,
    newContent: string,
    constraints: any
  ): Promise<any> {
    const dependencyGraph = this.registry.getMetadata<DependencyGraph>("dependencyGraph");
    const indexStateManager = this.registry.getMetadata<IndexStateManager>("indexStateManager");
    const guardrailTargetPath = resolveGuardrailTargetPath(targetPath);
    return evaluateIntegrityGuardrails({
      targetPath: guardrailTargetPath,
      oldContent: normalizeGuardrailContent(oldContent),
      newContent: normalizeGuardrailContent(newContent),
      dependencyGraph,
      indexStateManager,
      constraints,
      runTool: (tool, args) => this.runTool(context, tool, args),
      applyMode: true
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
      status: output?.success === false || output?.isError ? 'failure' : 'success',
      duration: Date.now() - started
    });
    return output;
  }

  private parseGenerationIntent(intent: string, targetPath: string): { templateType: TemplateType; context: TemplateContext } | null {
    const lowerIntent = intent.toLowerCase();
    const baseName = path.basename(targetPath, path.extname(targetPath));
    const name = this.extractNameFromIntent(intent, baseName);

    if (lowerIntent.includes('function') || lowerIntent.includes('func')) {
      return {
        templateType: 'function',
        context: {
          name,
          params: this.extractParams(intent),
          returnType: this.extractReturnType(intent),
          export: lowerIntent.includes('export'),
          description: this.extractDescription(intent),
        },
      };
    }

    if (lowerIntent.includes('class')) {
      return {
        templateType: 'class',
        context: {
          name: this.toPascalCase(name),
          export: lowerIntent.includes('export') || !lowerIntent.includes('internal'),
          description: this.extractDescription(intent),
          properties: [],
          methods: [],
        },
      };
    }

    if (lowerIntent.includes('interface') || lowerIntent.includes('type')) {
      return {
        templateType: 'interface',
        context: {
          name: this.toPascalCase(name),
          export: lowerIntent.includes('export') || !lowerIntent.includes('internal'),
          description: this.extractDescription(intent),
          properties: [],
          methods: [],
        },
      };
    }

    return { templateType: 'function', context: { name, export: true, description: intent } };
  }

  private extractNameFromIntent(intent: string, fallback: string): string {
    const patterns = [
      /(?:function|class|interface)\s+([a-zA-Z_][a-zA-Z0-9_]*)/i,
      /(?:named|called)\s+([a-zA-Z_][a-zA-Z0-9_]*)/i,
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:function|class)/i,
    ];
    for (const pattern of patterns) {
      const match = intent.match(pattern);
      if (match && match[1]) return match[1];
    }
    return fallback.replace(/[^a-zA-Z0-9_]/g, '') || 'generated';
  }

  private extractParams(intent: string): string {
    const match = intent.match(/(?:params?|parameters?|args?|arguments?)\s*\(([^)]+)\)/i);
    if (match && match[1]) return match[1].trim();
    const takesMatch = intent.match(/(?:takes?|accepts?)\s+([a-zA-Z0-9_,\s]+)/i);
    if (takesMatch && takesMatch[1]) {
      return takesMatch[1].split(/\s+and\s+|\s*,\s*/).map(p => p.trim()).join(', ');
    }
    return '';
  }

  private extractReturnType(intent: string): string {
    const patterns = [/returns?\s+([a-zA-Z0-9_<>[\]]+)/i, /return\s+type\s*:\s*([a-zA-Z0-9_<>[\]]+)/i];
    for (const pattern of patterns) {
      const match = intent.match(pattern);
      if (match && match[1]) return match[1];
    }
    return 'void';
  }

  private extractDescription(intent: string): string {
    let desc = intent.replace(/^(?:create|generate|make|add|write)\s+/i, '').replace(/^(?:a|an|the)\s+/i, '').trim();
    if (desc.length > 0) desc = desc.charAt(0).toUpperCase() + desc.slice(1);
    return desc || 'Auto-generated code';
  }

  private async writeGeneratedCode(
    filePath: string,
    content: string,
    intent: string,
    context: OrchestrationContext,
    templateType: TemplateType,
    imports?: string[],
    constraints?: any
  ): Promise<any> {
    try {
      let finalContent = content;
      if (imports && imports.length > 0) finalContent = imports.join('\n') + '\n\n' + content;
      let existingContent = '';
      try {
        existingContent = await this.runTool(context, 'code_read', { filePath, view: 'full' });
      } catch {
        try {
          await this.runTool(context, 'file_write', { filePath, content: '' });
        } catch {
          await this.runTool(context, 'edit_apply', { edits: [{ filePath, operation: 'create', replacementString: '' }], dryRun: false, createMissingDirectories: true });
        }
        existingContent = '';
      }
      const guardrailResult = await this.evaluateGuardrails(
        context,
        filePath,
        existingContent,
        finalContent,
        constraints
      );
      if (guardrailResult?.status === 'block') {
        return {
          success: false,
          status: 'blocked',
          createdFiles: [],
          transactionId: '',
          rollbackAvailable: false,
          writeMode: 'quickGenerate',
          templateType,
          architecturalRisk: guardrailResult.architecturalRisk,
          architecturalWarnings: guardrailResult.architecturalWarnings,
          safetyChecklist: guardrailResult.safetyChecklist,
          blockingErrors: guardrailResult.blockingErrors,
          errorCode: guardrailResult.errorCode ?? 'ARCHITECTURE_BLOCKED',
          blockedReason: guardrailResult.blockedReason ?? 'architectural_violation',
          violations: guardrailResult.violations,
          warnings: guardrailResult.warnings,
          guidance: {
            message: guardrailResult.violations?.[0]?.message ?? 'Write blocked by integrity guardrails.'
          }
        };
      }
      const edit = { targetString: existingContent, replacementString: finalContent, indexRange: { start: 0, end: existingContent.length }, expectedHash: existingContent ? this.computeHash(existingContent) : undefined };
      const result = await this.runTool(context, 'edit_transaction', { filePath, edits: [edit], dryRun: false });
      return {
        success: result.success ?? true,
        status: result.success === false ? 'failure' : 'success',
        createdFiles: result.success ? [{ path: filePath, description: `Generated ${templateType} from intent: ${intent}` }] : [],
        transactionId: result.operation?.id || '',
        rollbackAvailable: true,
        writeMode: 'quickGenerate',
        templateType,
        architecturalRisk: guardrailResult?.architecturalRisk,
        architecturalWarnings: guardrailResult?.architecturalWarnings,
        safetyChecklist: guardrailResult?.safetyChecklist,
        blockingErrors: guardrailResult?.blockingErrors,
        errorCode: guardrailResult?.errorCode,
        blockedReason: guardrailResult?.blockedReason,
        violations: guardrailResult?.violations,
        warnings: guardrailResult?.warnings,
        guidance: {
          message: result.success ? `Generated ${templateType} with project style. Use 'manage undo' to rollback.` : `Generation failed: ${result.message || 'Unknown error'}`,
          suggestedActions: result.success ? [{ pillar: 'read', action: 'view_full', target: filePath }] : []
        }
      };
    } catch (error: any) {
      return { success: false, status: 'failure', createdFiles: [], transactionId: '', rollbackAvailable: false, writeMode: 'quickGenerate', guidance: { message: `Quick generate failed: ${error.message}`, suggestedActions: [] } };
    }
  }
}
