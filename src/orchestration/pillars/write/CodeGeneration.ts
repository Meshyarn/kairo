import path from "path";
import { OrchestrationContext } from "../../OrchestrationContext.js";
import { StyleInference } from "../../../generation/StyleInference.js";
import { SimpleTemplateGenerator, type TemplateType, type TemplateContext } from "../../../generation/SimpleTemplateGenerator.js";
import { NodeFileSystem } from "../../../platform/FileSystem.js";
import { PatternExtractor, type ProjectPatterns } from "../../../generation/PatternExtractor.js";
import { TemplateGenerator } from "../../../generation/TemplateGenerator.js";

export async function smartWriteCode(
    resolvedPath: string,
    intent: string,
    constraints: any,
    context: OrchestrationContext,
    runTool: (context: OrchestrationContext, tool: string, args: any) => Promise<any>,
    parseGenerationIntent: (intent: string, targetPath: string) => any,
    styleReference?: string[]
): Promise<{ code: string; templateType: TemplateType; imports: string[] } | null> {
    try {
        let similarFiles: string[] = [];
        
        if (styleReference && styleReference.length > 0) {
            similarFiles = styleReference;
        } else {
            const similarCount = 5;
            try {
                const searchResults = await runTool(context, 'project_search', {
                    query: intent,
                    type: 'semantic',
                    maxResults: similarCount
                });
                
                if (searchResults?.results) {
                    similarFiles = searchResults.results
                        .map((r: any) => r.path)
                        .filter((p: string) => p && p !== resolvedPath)
                        .slice(0, similarCount);
                }
            } catch (err) {
                // Ignore
            }
        }

        if (similarFiles.length === 0) return null;

        const dirPath = path.dirname(resolvedPath);
        const fs = new NodeFileSystem(dirPath);
        const patternExtractor = new PatternExtractor(fs, dirPath, {});
        const patterns: ProjectPatterns = await patternExtractor.extractPatterns(similarFiles);

        if (!patterns || Object.keys(patterns).length === 0) return null;

        const styleInference = new StyleInference(fs, dirPath, {});
        const styleResult = await styleInference.inferStyle(path.extname(resolvedPath));
        const { confidence, ...style } = styleResult;

        const parsed = parseGenerationIntent(intent, resolvedPath);
        if (!parsed) return null;
        const { templateType, context: templateContext } = parsed;

        const templateGenerator = new TemplateGenerator(style);
        const generated = templateGenerator.generateAdvanced(templateType, {
            ...templateContext,
            patterns,
            usePatterns: true
        });

        if (!generated || !generated.code) return null;

        return {
            code: generated.code,
            templateType,
            imports: generated.imports || []
        };
    } catch (err) {
        return null;
    }
}

export async function quickGenerateCode(
    targetPath: string,
    intent: string,
    parseGenerationIntent: (intent: string, targetPath: string) => any
): Promise<{ code: string; templateType: TemplateType } | null> {
    const rootPath = process.cwd();
    const fileSystem = new NodeFileSystem(rootPath);
    
    const ext = path.extname(targetPath);
    const styleInference = new StyleInference(fileSystem, rootPath);
    const style = await styleInference.inferStyle(ext);

    const parseResult = parseGenerationIntent(intent, targetPath);
    if (!parseResult) return null;

    const { templateType, context: templateContext } = parseResult;

    const generator = new SimpleTemplateGenerator(style);
    const code = generator.generate(templateType, templateContext);

    return { code, templateType };
}

export async function resolveTemplateContent(
    template: string,
    targetPath: string,
    intent: string,
    context: OrchestrationContext,
    runTool: (context: OrchestrationContext, tool: string, args: any) => Promise<any>,
    toPascalCase: (v: string) => string,
    looksLikePath: (v: string) => boolean
): Promise<string | null> {
    const trimmed = template.trim();
    if (!trimmed) return null;

    if (looksLikePath(trimmed)) {
        try {
            const raw = await runTool(context, 'code_read', { filePath: trimmed, view: 'full' });
            if (typeof raw === 'string' && raw.length > 0) {
                return raw;
            }
        } catch {
            // Fall through
        }
    }

    const normalized = trimmed.toLowerCase();
    const ext = path.extname(targetPath).toLowerCase();
    const baseName = path.basename(targetPath, ext);
    const className = toPascalCase(baseName || 'Generated');

    if (normalized.includes('test') || normalized.includes('jest') || normalized.includes('spec')) {
        if (ext === '.ts' || ext === '.tsx') {
            return `import { describe, it, expect } from "@jest/globals";\n\n` +
                `describe("${className}", () => {\n  it("todo", () => {\n    expect(true).toBe(true);\n  });\n});\n`;
        }
        if (ext === '.js' || ext === '.jsx') {
            return `describe("${className}", () => {\n  it("todo", () => {\n    expect(true).toBe(true);\n  });\n});\n`;
        }
    }

    if (normalized.includes('class') || normalized.includes('service') || normalized.includes('module')) {
        if (ext === '.ts' || ext === '.tsx') {
            return `export class ${className} {\n  constructor() {}\n}\n`;
        }
        if (ext === '.js' || ext === '.jsx') {
            return `class ${className} {\n  constructor() {}\n}\n\nmodule.exports = { ${className} };\n`;
        }
    }

    if (normalized.includes('readme') || ext === '.md') {
        return `# ${className}\n\n${intent}\n`;
    }

    return `// Template: ${template}\n`;
}
