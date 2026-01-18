import path from "path";
import ts from "typescript";
import { NodeFileSystem, type IFileSystem } from "../platform/FileSystem.js";

export interface PropertyAccessLocation {
    filePath: string;
    line: number;
    column: number;
    propertyChain: string[];
}

type IndexKey = {
    packageName: string;
    exportName: string;
    fieldName: string;
};

export class PropertyAccessIndex {
    private usages = new Map<string, PropertyAccessLocation[]>();
    private readonly fileSystem: IFileSystem;

    constructor(private readonly rootPath: string, fileSystem?: IFileSystem) {
        this.fileSystem = fileSystem ?? new NodeFileSystem(rootPath);
    }

    public indexFile(
        filePath: string,
        options?: {
            content?: string;
            packageName?: string;
            exportNames?: string[];
        }
    ): void {
        const content = options?.content ?? this.fileSystem.readFileSync?.(filePath) ?? (() => { throw new Error("IFileSystem.readFileSync is required"); })();
        const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.ES2022, true);
        const exportNames = new Set(options?.exportNames ?? []);
        const packageName = options?.packageName ?? "unknown";
        const variableTypes = new Map<string, string>();

        const recordVariableType = (name: string, exportName?: string) => {
            if (!exportName) return;
            variableTypes.set(name, exportName);
        };

        const resolveTypeName = (typeNode: ts.TypeNode | undefined): string | undefined => {
            if (!typeNode) return undefined;
            if (ts.isTypeReferenceNode(typeNode)) {
                const typeName = typeNode.typeName.getText(sourceFile);
                return exportNames.has(typeName) ? typeName : undefined;
            }
            if (ts.isArrayTypeNode(typeNode)) {
                return resolveTypeName(typeNode.elementType);
            }
            return undefined;
        };

        const visitDeclarations = (node: ts.Node) => {
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
                const typeName = resolveTypeName(node.type);
                recordVariableType(node.name.text, typeName);
                if (!typeName && node.initializer && ts.isNewExpression(node.initializer)) {
                    const ctor = node.initializer.expression;
                    if (ts.isIdentifier(ctor) && exportNames.has(ctor.text)) {
                        recordVariableType(node.name.text, ctor.text);
                    }
                }
            }
            if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
                const typeName = resolveTypeName(node.type);
                recordVariableType(node.name.text, typeName);
            }
            ts.forEachChild(node, visitDeclarations);
        };

        const visitPropertyAccess = (node: ts.Node) => {
            if (ts.isPropertyAccessExpression(node)) {
                const { base, chain } = this.extractChain(node);
                if (base && chain.length > 0) {
                    const exportName = variableTypes.get(base);
                    if (exportName) {
                        const fieldName = chain[chain.length - 1];
                        const loc = sourceFile.getLineAndCharacterOfPosition(node.name.getStart(sourceFile));
                        this.recordUsage(
                            {
                                packageName,
                                exportName,
                                fieldName
                            },
                            {
                                filePath,
                                line: loc.line + 1,
                                column: loc.character + 1,
                                propertyChain: chain
                            }
                        );
                    }
                }
            }
            ts.forEachChild(node, visitPropertyAccess);
        };

        visitDeclarations(sourceFile);
        visitPropertyAccess(sourceFile);
    }

    public getUsages(packageName: string, exportName: string, fieldName: string): PropertyAccessLocation[] {
        const key = this.serializeKey({ packageName, exportName, fieldName });
        return this.usages.get(key) ?? [];
    }

    private recordUsage(key: IndexKey, location: PropertyAccessLocation): void {
        const serialized = this.serializeKey(key);
        const existing = this.usages.get(serialized) ?? [];
        existing.push(location);
        this.usages.set(serialized, existing);
    }

    private serializeKey(key: IndexKey): string {
        return [key.packageName, key.exportName, key.fieldName].join("|");
    }

    private extractChain(node: ts.PropertyAccessExpression): { base?: string; chain: string[] } {
        const chain: string[] = [node.name.getText()];
        let current: ts.Expression = node.expression;

        while (ts.isPropertyAccessExpression(current)) {
            chain.unshift(current.name.getText());
            current = current.expression;
        }

        if (ts.isIdentifier(current)) {
            return { base: current.text, chain };
        }

        return { chain };
    }
}
