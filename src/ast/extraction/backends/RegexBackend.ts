import { performance } from 'perf_hooks';
import type { ExtractionBackend, ExtractionRequest } from './AstBackend.js';
import type { ImportInfo, ExportInfo } from '../../../indexing/ProjectIndex.js';
import type { SymbolInfo, TopologyInfo } from '../../../types.js';
import { ModuleResolver } from '../../ModuleResolver.js';

type RegexExport = TopologyInfo['exports'][number] & { lineNumber: number };

interface RegexExtraction {
    imports: TopologyInfo['imports'];
    exports: RegexExport[];
    topLevelSymbols: TopologyInfo['topLevelSymbols'];
    confidence: number;
}

export class RegexBackend implements ExtractionBackend {
    public readonly name = 'regex';
    private readonly supportedLanguages = new Set(['typescript', 'tsx', 'javascript', 'ts', 'js', 'jsx']);
    private readonly moduleResolver?: ModuleResolver;

    private readonly IMPORT_PATTERN = new RegExp("import\\s+(?:(?:type|typeof)\\s+)?(?:{[^}]*}|[\\w*]+|\\*\\s+as\\s+\\w+)(?:\\s*,\\s*(?:{[^}]*}|[\\w*]+))?\\s+from\\s+['\"]([^'\"]+)['\"]", "g");
    private readonly IMPORT_DEFAULT_PATTERN = new RegExp("import\\s+(?:(?:type|typeof)\\s+)?([\\w$]+)\\s+from\\s+['\"]([^'\"]+)['\"]", "g");
    private readonly IMPORT_STAR_PATTERN = new RegExp("import\\s+\\*\\s+as\\s+([\\w$]+)\\s+from\\s+['\"]([^'\"]+)['\"]", "g");
    private readonly IMPORT_SIDE_EFFECT_PATTERN = new RegExp("import\\s+['\"]([^'\"]+)['\"]", "g");
    private readonly DYNAMIC_IMPORT_PATTERN = new RegExp("import\\s*\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)", "g");
    private readonly REQUIRE_DEFAULT_PATTERN = new RegExp("(?:const|let|var)\\s+([\\w$]+)\\s*=\\s*require\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)", "g");
    private readonly REQUIRE_DESTRUCTURED_PATTERN = new RegExp("(?:const|let|var)\\s+{([^}]+)}\\s*=\\s*require\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)", "g");

    private readonly EXPORT_NAMED_PATTERN = new RegExp("export\\s+(?:const|let|var|function|class|interface|type|enum)\\s+([\\w$]+)", "g");
    private readonly EXPORT_DEFAULT_PATTERN = new RegExp("export\\s+default\\s+", "g");
    private readonly EXPORT_FROM_PATTERN = new RegExp("export\\s+(?:{[^}]*}|\\*)\\s+from\\s+['\"]([^'\"]+)['\"]", "g");

    private readonly TOP_LEVEL_FUNCTION_PATTERN = new RegExp("(?:^|\\n)\\s*(?:export\\s+)?function\\s+([\\w$]+)\\s*\\(", "gm");
    private readonly TOP_LEVEL_CLASS_PATTERN = new RegExp("(?:^|\\n)\\s*(?:export\\s+)?class\\s+([\\w$]+)", "gm");
    private readonly TOP_LEVEL_INTERFACE_PATTERN = new RegExp("(?:^|\\n)\\s*(?:export\\s+)?interface\\s+([\\w$]+)", "gm");
    private readonly TOP_LEVEL_TYPE_PATTERN = new RegExp("(?:^|\\n)\\s*(?:export\\s+)?type\\s+([\\w$]+)\\s*=", "gm");
    private readonly TOP_LEVEL_CONST_PATTERN = new RegExp("(?:^|\\n)\\s*(?:export\\s+)?const\\s+([\\w$]+)\\s*=", "gm");
    private readonly TOP_LEVEL_LET_PATTERN = new RegExp("(?:^|\\n)\\s*(?:export\\s+)?let\\s+([\\w$]+)\\s*=", "gm");
    private readonly TOP_LEVEL_VAR_PATTERN = new RegExp("(?:^|\\n)\\s*(?:export\\s+)?var\\s+([\\w$]+)\\s*=", "gm");

    constructor(moduleResolver?: ModuleResolver) {
        this.moduleResolver = moduleResolver;
    }

    public supportsLanguage(languageId: string): boolean {
        return this.supportedLanguages.has(languageId.toLowerCase());
    }

    public async extractTopology(request: ExtractionRequest): Promise<TopologyInfo> {
        const startTime = performance.now();
        const extraction = this.extractViaRegex(request.filePath, request.content);
        return {
            path: request.filePath,
            imports: extraction.imports,
            exports: extraction.exports.map(({ lineNumber, ...rest }) => rest),
            topLevelSymbols: extraction.topLevelSymbols,
            confidence: extraction.confidence,
            fallbackUsed: false,
            extractionTimeMs: performance.now() - startTime
        };
    }

    public async extractImports(request: ExtractionRequest): Promise<ImportInfo[]> {
        const extraction = this.extractViaRegex(request.filePath, request.content);
        return extraction.imports.map(importEntry => this.toImportInfo(request.filePath, importEntry));
    }

    public async extractExports(request: ExtractionRequest): Promise<ExportInfo[]> {
        const extraction = this.extractViaRegex(request.filePath, request.content);
        return extraction.exports.map(exp => ({
            name: exp.name,
            exportType: exp.isDefault ? 'default' : 'named',
            line: exp.lineNumber,
            isReExport: Boolean(exp.reExportFrom),
            reExportFrom: exp.reExportFrom ? this.resolve(request.filePath, exp.reExportFrom) : undefined
        }));
    }

    public async extractSymbols(request: ExtractionRequest): Promise<SymbolInfo[]> {
        const extraction = this.extractViaRegex(request.filePath, request.content);
        return extraction.topLevelSymbols.map(symbol => ({
            name: symbol.name,
            type: symbol.kind as any,
            level: symbol.level,
            range: {
                startLine: Math.max(0, symbol.lineNumber - 1),
                endLine: Math.max(0, symbol.lineNumber - 1),
                startByte: 0,
                endByte: 0
            }
        }));
    }

    private extractViaRegex(filePath: string, content: string): RegexExtraction {
        const importsMap = new Map<string, TopologyInfo['imports'][number]>();
        const exports: RegexExport[] = [];
        const topLevelSymbols: TopologyInfo['topLevelSymbols'] = [];
        const dynamicImports: TopologyInfo['imports'] = [];
        const cleanContent = this.removeComments(content);

        const ensureImportEntry = (source: string, index: number) => {
            if (!importsMap.has(source)) {
                importsMap.set(source, {
                    source,
                    isDefault: false,
                    namedImports: [],
                    isTypeOnly: false,
                    isDynamic: false,
                    lineNumber: this.getLineNumber(content, index)
                });
            }
            const entry = importsMap.get(source)!;
            const lineNumber = this.getLineNumber(content, index);
            if (!entry.lineNumber || lineNumber < entry.lineNumber) {
                entry.lineNumber = lineNumber;
            }
            return entry;
        };

        const appendUnique = (collection: string[], value: string) => {
            if (!value) return;
            if (!collection.includes(value)) {
                collection.push(value);
            }
        };

        const extractNamedImports = (statement: string, entry: TopologyInfo['imports'][number]) => {
            const braceMatches = statement.match(/{([^}]+)}/g) ?? [];
            for (const block of braceMatches) {
                const names = block
                    .replace('{', '')
                    .replace('}', '')
                    .split(',')
                    .map((token) => token.trim())
                    .filter(Boolean);
                const typeNames: string[] = [];
                const valueNames: string[] = [];
                for (const rawName of names) {
                    const cleaned = rawName.replace(/^type\s+/, '');
                    const aliasMatch = cleaned.match(/\s+as\s+([\w$]+)$/);
                    const finalName = aliasMatch ? aliasMatch[1] : cleaned.replace(/\s+as\s+.+$/, '').trim();
                    const isTypeOnly = /^type\s+/.test(rawName) || /import\s+type/.test(statement);
                    if (isTypeOnly) {
                        typeNames.push(finalName);
                    } else {
                        valueNames.push(finalName);
                    }
                    if (isTypeOnly) {
                        entry.isTypeOnly = true;
                    }
                }
                for (const name of typeNames) {
                    appendUnique(entry.namedImports, name);
                }
                for (const name of valueNames) {
                    appendUnique(entry.namedImports, name);
                }
            }
            if (/import\s+type\s+/.test(statement)) {
                entry.isTypeOnly = true;
            }
        };

        let match: RegExpExecArray | null;

        this.IMPORT_PATTERN.lastIndex = 0;
        while ((match = this.IMPORT_PATTERN.exec(cleanContent)) !== null) {
            const source = match[1];
            const statement = match[0];
            const entry = ensureImportEntry(source, match.index);
            extractNamedImports(statement, entry);
        }

        this.IMPORT_STAR_PATTERN.lastIndex = 0;
        while ((match = this.IMPORT_STAR_PATTERN.exec(cleanContent)) !== null) {
            const alias = match[1];
            const source = match[2];
            const entry = ensureImportEntry(source, match.index);
            appendUnique(entry.namedImports, `* as ${alias}`);
        }

        this.IMPORT_DEFAULT_PATTERN.lastIndex = 0;
        while ((match = this.IMPORT_DEFAULT_PATTERN.exec(cleanContent)) !== null) {
            const name = match[1];
            const source = match[2];
            const entry = ensureImportEntry(source, match.index);
            entry.isDefault = true;
            appendUnique(entry.namedImports, name);
            if (/import\s+type\s+/.test(match[0])) {
                entry.isTypeOnly = true;
            }
        }

        this.IMPORT_SIDE_EFFECT_PATTERN.lastIndex = 0;
        while ((match = this.IMPORT_SIDE_EFFECT_PATTERN.exec(cleanContent)) !== null) {
            const source = match[1];
            ensureImportEntry(source, match.index);
        }

        this.REQUIRE_DEFAULT_PATTERN.lastIndex = 0;
        while ((match = this.REQUIRE_DEFAULT_PATTERN.exec(cleanContent)) !== null) {
            const name = match[1];
            const source = match[2];
            const entry = ensureImportEntry(source, match.index);
            entry.isDefault = true;
            appendUnique(entry.namedImports, name);
        }

        this.REQUIRE_DESTRUCTURED_PATTERN.lastIndex = 0;
        while ((match = this.REQUIRE_DESTRUCTURED_PATTERN.exec(cleanContent)) !== null) {
            const names = match[1]
                .split(',')
                .map((token) => token.trim())
                .filter(Boolean);
            const source = match[2];
            const entry = ensureImportEntry(source, match.index);
            for (const rawName of names) {
                const aliasMatch = rawName.match(/\s+as\s+([\w$]+)$/);
                const finalName = aliasMatch ? aliasMatch[1] : rawName.replace(/\s+as\s+.+$/, '').trim();
                appendUnique(entry.namedImports, finalName);
            }
        }

        this.DYNAMIC_IMPORT_PATTERN.lastIndex = 0;
        while ((match = this.DYNAMIC_IMPORT_PATTERN.exec(cleanContent)) !== null) {
            dynamicImports.push({
                source: match[1],
                isDefault: false,
                namedImports: [],
                isTypeOnly: false,
                isDynamic: true,
                lineNumber: this.getLineNumber(content, match.index)
            });
        }

        this.EXPORT_NAMED_PATTERN.lastIndex = 0;
        while ((match = this.EXPORT_NAMED_PATTERN.exec(cleanContent)) !== null) {
            exports.push({
                name: match[1],
                isDefault: false,
                isTypeOnly: /export\s+(?:type|interface)/.test(match[0]),
                lineNumber: this.getLineNumber(content, match.index)
            });
        }

        this.EXPORT_DEFAULT_PATTERN.lastIndex = 0;
        while ((match = this.EXPORT_DEFAULT_PATTERN.exec(cleanContent)) !== null) {
            exports.push({
                name: 'default',
                isDefault: true,
                isTypeOnly: false,
                lineNumber: this.getLineNumber(content, match.index)
            });
        }

        this.EXPORT_FROM_PATTERN.lastIndex = 0;
        while ((match = this.EXPORT_FROM_PATTERN.exec(cleanContent)) !== null) {
            exports.push({
                name: '*',
                isDefault: false,
                isTypeOnly: false,
                reExportFrom: match[1],
                lineNumber: this.getLineNumber(content, match.index)
            });
        }

        const symbolsFound = new Set<string>();
        const addSymbol = (
            name: string,
            kind: TopologyInfo['topLevelSymbols'][number]['kind'],
            exported: boolean,
            index: number
        ) => {
            if (!name || symbolsFound.has(name)) return;
            symbolsFound.add(name);
            topLevelSymbols.push({ name, kind, exported, lineNumber: this.getLineNumber(content, index) });
        };

        this.TOP_LEVEL_FUNCTION_PATTERN.lastIndex = 0;
        while ((match = this.TOP_LEVEL_FUNCTION_PATTERN.exec(cleanContent)) !== null) {
            addSymbol(match[1], 'function', /export/.test(match[0]), match.index);
        }

        this.TOP_LEVEL_CLASS_PATTERN.lastIndex = 0;
        while ((match = this.TOP_LEVEL_CLASS_PATTERN.exec(cleanContent)) !== null) {
            addSymbol(match[1], 'class', /export/.test(match[0]), match.index);
        }

        this.TOP_LEVEL_INTERFACE_PATTERN.lastIndex = 0;
        while ((match = this.TOP_LEVEL_INTERFACE_PATTERN.exec(cleanContent)) !== null) {
            addSymbol(match[1], 'interface', /export/.test(match[0]), match.index);
        }

        this.TOP_LEVEL_TYPE_PATTERN.lastIndex = 0;
        while ((match = this.TOP_LEVEL_TYPE_PATTERN.exec(cleanContent)) !== null) {
            addSymbol(match[1], 'type', /export/.test(match[0]), match.index);
        }

        this.TOP_LEVEL_CONST_PATTERN.lastIndex = 0;
        while ((match = this.TOP_LEVEL_CONST_PATTERN.exec(cleanContent)) !== null) {
            addSymbol(match[1], 'const', /export/.test(match[0]), match.index);
        }

        this.TOP_LEVEL_LET_PATTERN.lastIndex = 0;
        while ((match = this.TOP_LEVEL_LET_PATTERN.exec(cleanContent)) !== null) {
            addSymbol(match[1], 'let', /export/.test(match[0]), match.index);
        }

        this.TOP_LEVEL_VAR_PATTERN.lastIndex = 0;
        while ((match = this.TOP_LEVEL_VAR_PATTERN.exec(cleanContent)) !== null) {
            addSymbol(match[1], 'var', /export/.test(match[0]), match.index);
        }

        const imports = [...importsMap.values(), ...dynamicImports];
        const confidence = this.calculateConfidence(content, imports, exports, topLevelSymbols);

        return { imports, exports, topLevelSymbols, confidence };
    }

    private removeComments(content: string): string {
        let result = '';
        let inString = false;
        let stringChar = '';
        let inSingleLineComment = false;
        let inMultiLineComment = false;

        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            const next = content[i + 1];

            if (inSingleLineComment) {
                if (char === '\n') {
                    inSingleLineComment = false;
                    result += char;
                }
                continue;
            }

            if (inMultiLineComment) {
                if (char === '*' && next === '/') {
                    inMultiLineComment = false;
                    i++;
                }
                continue;
            }

            if (!inString) {
                if (char === '/' && next === '/') {
                    inSingleLineComment = true;
                    i++;
                    continue;
                }
                if (char === '/' && next === '*') {
                    inMultiLineComment = true;
                    i++;
                    continue;
                }
                if (char === '"' || char === '\'' || char === '`') {
                    inString = true;
                    stringChar = char;
                    result += char;
                    continue;
                }
                result += char;
                continue;
            }

            result += char;
            if (char === '\\') {
                if (i + 1 < content.length) {
                    result += content[++i];
                }
                continue;
            }
            if (char === stringChar) {
                inString = false;
                stringChar = '';
            }
        }

        return result;
    }

    private calculateConfidence(
        content: string,
        imports: TopologyInfo['imports'],
        exports: RegexExport[],
        symbols: TopologyInfo['topLevelSymbols']
    ): number {
        let confidence = 1.0;
        const dynamicImports = imports.filter(i => i.isDynamic).length;
        confidence -= dynamicImports * 0.05;
        const reExports = exports.filter(e => Boolean(e.reExportFrom)).length;
        confidence -= reExports * 0.03;
        const lines = content.split(/\r?\n/).length;
        const isVeryLargeFile = lines > 1000;
        if (isVeryLargeFile) {
            confidence -= 0.1;
        } else if (lines > 500) {
            confidence -= 0.05;
        }
        if (imports.length === 0 && exports.length === 0 && symbols.length === 0 && lines > 50) {
            confidence -= 0.2;
        }
        const standardImports = imports.filter(i => !i.isDynamic && !i.isTypeOnly).length;
        if (!isVeryLargeFile && standardImports > 0 && standardImports === imports.filter(i => !i.isDynamic).length) {
            confidence += 0.05;
        }
        return Math.max(0.0, Math.min(1.0, confidence));
    }

    private getLineNumber(content: string, index: number): number {
        return content.substring(0, index).split(new RegExp("\\r?\\n")).length;
    }

    private toImportInfo(filePath: string, entry: TopologyInfo['imports'][number]): ImportInfo {
        const hasNamespace = entry.namedImports.some(name => name.trim().startsWith('* as '));
        const importType: ImportInfo['importType'] = entry.isDynamic
            ? 'side-effect'
            : hasNamespace
                ? 'namespace'
                : entry.isDefault
                    ? 'default'
                    : entry.namedImports.length > 0
                        ? 'named'
                        : 'side-effect';

        const what = hasNamespace
            ? ['*']
            : entry.isDynamic
                ? []
                : entry.namedImports;

        return {
            specifier: entry.source,
            resolvedPath: this.resolve(filePath, entry.source),
            what,
            line: entry.lineNumber,
            importType
        };
    }

    private resolve(contextPath: string, specifier: string): string | undefined {
        if (!this.moduleResolver) return undefined;
        return this.moduleResolver.resolve(contextPath, specifier) ?? undefined;
    }
}
