/**
 * ADR-042-006: Phase 3 - PatternExtractor
 * 
 * Extracts common patterns from project files:
 * - Import/export patterns
 * - Naming conventions (camelCase, PascalCase, kebab-case, etc.)
 * - File organization patterns
 * - Common code structures
 */

import { IFileSystem } from "../platform/FileSystem.js";
import { extractExportPatterns, extractImportPatterns } from "./PatternExtractionImports.js";
import { detectNamingConventions, extractNamingPatterns } from "./PatternExtractionNaming.js";
import { extractAffixes, extractFilePatterns } from "./PatternExtractionFiles.js";
import { filterByFrequency } from "./PatternExtractionUtils.js";

/**
 * Import pattern information
 */
export interface ImportPattern {
    /** Module being imported */
    module: string;
    /** Import style: default, named, namespace, side-effect */
    style: 'default' | 'named' | 'namespace' | 'side-effect';
    /** Named imports if style is 'named' */
    namedImports?: string[];
    /** Alias if used */
    alias?: string;
    /** Frequency count */
    count: number;
}

/**
 * Export pattern information
 */
export interface ExportPattern {
    /** Export style: default, named, namespace */
    style: 'default' | 'named' | 'namespace';
    /** What is being exported */
    exportedNames: string[];
    /** Frequency count */
    count: number;
}

/**
 * Naming convention pattern
 */
export interface NamingPattern {
    /** Pattern type */
    type: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'constant';
    /** Convention: camelCase, PascalCase, UPPER_CASE, kebab-case */
    convention: 'camelCase' | 'PascalCase' | 'UPPER_CASE' | 'kebab-case' | 'snake_case';
    /** Confidence (0-1) */
    confidence: number;
    /** Sample names */
    samples: string[];
}

/**
 * File organization pattern
 */
export interface FilePattern {
    /** Common file name patterns */
    fileNamePattern: string;
    /** Common directory structures */
    directoryPattern: string;
    /** Test file patterns */
    testPattern?: string;
}

/**
 * Extracted project patterns
 */
export interface ProjectPatterns {
    /** Import patterns */
    imports: ImportPattern[];
    /** Export patterns */
    exports: ExportPattern[];
    /** Naming conventions */
    naming: NamingPattern[];
    /** File organization */
    fileOrg: FilePattern;
    /** Common prefixes/suffixes */
    affixes: {
        prefixes: string[];
        suffixes: string[];
    };
}

/**
 * Configuration for pattern extraction
 */
export interface PatternExtractionConfig {
    /** Maximum files to analyze */
    maxFiles: number;
    /** File extensions to include */
    extensions: string[];
    /** Minimum pattern frequency to include */
    minFrequency: number;
}

const DEFAULT_CONFIG: PatternExtractionConfig = {
    maxFiles: 50,
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    minFrequency: 2,
};

/**
 * PatternExtractor - Phase 3 Full Code Generation
 * 
 * Analyzes project files to extract common patterns:
 * - Import/export conventions
 * - Naming conventions
 * - File organization patterns
 * 
 * Used by TemplateGenerator to create code that matches project style.
 */
export class PatternExtractor {
    private readonly config: PatternExtractionConfig;

    constructor(
        private readonly fileSystem: IFileSystem,
        private readonly rootPath: string,
        config?: Partial<PatternExtractionConfig>
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Extract patterns from similar files
     * 
     * @param similarFiles Paths to files similar to target
     * @returns Extracted project patterns
     */
    public async extractPatterns(similarFiles: string[]): Promise<ProjectPatterns> {
        const filesToAnalyze = similarFiles.slice(0, this.config.maxFiles);
        
        const imports: Map<string, ImportPattern> = new Map();
        const exports: Map<string, ExportPattern> = new Map();
        const functionNames: string[] = [];
        const classNames: string[] = [];
        const interfaceNames: string[] = [];
        const variableNames: string[] = [];
        const constantNames: string[] = [];

        for (const filePath of filesToAnalyze) {
            try {
                const content = await this.fileSystem.readFile(filePath);
                
                // Extract imports
                extractImportPatterns(content, imports);
                
                // Extract exports
                extractExportPatterns(content, exports);
                
                // Extract naming patterns
                extractNamingPatterns(content, {
                    functionNames,
                    classNames,
                    interfaceNames,
                    variableNames,
                    constantNames,
                });
            } catch (error) {
                // Skip files we can't read
            }
        }

        return {
            imports: filterByFrequency(Array.from(imports.values()), this.config.minFrequency),
            exports: filterByFrequency(Array.from(exports.values()), this.config.minFrequency),
            naming: detectNamingConventions({
                functionNames,
                classNames,
                interfaceNames,
                variableNames,
                constantNames,
            }),
            fileOrg: extractFilePatterns(filesToAnalyze),
            affixes: extractAffixes({ functionNames, classNames, interfaceNames }, this.config.minFrequency),
        };
    }

    /**
     * Get current configuration
     */
    public getConfig(): PatternExtractionConfig {
        return { ...this.config };
    }
}
