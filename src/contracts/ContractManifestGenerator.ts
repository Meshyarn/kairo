import fs from "fs";
import path from "path";
import ts from "typescript";
import type { ContractManifest } from "../types/contract-manifest.js";

type GeneratorOptions = {
  sourceRepo: string;
  manifestRoot?: string;
  generatedAt?: number;
};

const normalizePackageName = (packageName: string) => packageName.replace(/\//g, "__");

export class ContractManifestGenerator {
  public static validateManifest(manifest: ContractManifest): boolean {
    if (!manifest?.header || !manifest?.surface) return false;
    if (manifest.header.version !== "1.0") return false;
    if (!manifest.header.kind || !manifest.header.id) return false;
    if (!manifest.surface.kind) return false;
    return true;
  }
  public generateFromDts(
    packageName: string,
    dtsPath: string,
    options: GeneratorOptions
  ): ContractManifest {
    const content = fs.readFileSync(dtsPath, "utf-8");
    return this.generateFromDtsContent(packageName, dtsPath, content, options);
  }

  public generateFromDtsContent(
    packageName: string,
    dtsPath: string,
    content: string,
    options: GeneratorOptions
  ): ContractManifest {
    const sourceFile = ts.createSourceFile(dtsPath, content, ts.ScriptTarget.ES2022, true);

    const exports: Record<string, unknown> = {};
    for (const stmt of sourceFile.statements) {
      if (!this.hasExportModifier(stmt)) continue;

      if (ts.isInterfaceDeclaration(stmt)) {
        exports[stmt.name.text] = {
          name: stmt.name.text,
          kind: "interface",
          fields: this.extractInterfaceFields(stmt, sourceFile)
        };
      } else if (ts.isClassDeclaration(stmt) && stmt.name) {
        exports[stmt.name.text] = {
          name: stmt.name.text,
          kind: "class",
          methods: this.extractClassMethods(stmt, sourceFile)
        };
      } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
        exports[stmt.name.text] = {
          name: stmt.name.text,
          kind: "function",
          signature: this.extractFunctionSignature(stmt, sourceFile)
        };
      }
    }

    return {
      header: {
        version: "1.0",
        kind: "ffi_napi",
        id: normalizePackageName(packageName),
        module: packageName,
        sourceRepo: options.sourceRepo,
        generatedAt: options.generatedAt ?? Date.now()
      },
      surface: {
        kind: "ffi_napi",
        exports
      }
    };
  }

  public writeManifest(
    manifest: ContractManifest,
    rootPath: string,
    kind: string = "ffi_napi"
  ): string {
    if (!ContractManifestGenerator.validateManifest(manifest)) {
      throw new Error("Invalid contract manifest schema.");
    }
    const outDir = path.join(rootPath, ".kairo", "contracts", kind);
    fs.mkdirSync(outDir, { recursive: true });
    const fileName = `${manifest.header.id}.json`;
    const outputPath = path.join(outDir, fileName);
    fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), "utf-8");
    return outputPath;
  }

  private hasExportModifier(node: ts.Node): boolean {
    if (!ts.canHaveModifiers(node)) return false;
    const modifiers = ts.getModifiers(node) ?? [];
    return modifiers.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword);
  }

  private extractInterfaceFields(node: ts.InterfaceDeclaration, sourceFile: ts.SourceFile) {
    const fields: Array<{ name: string; type: string }> = [];
    for (const member of node.members) {
      if (!ts.isPropertySignature(member) || !member.name) continue;
      const name = this.getNameText(member.name, sourceFile);
      fields.push({
        name,
        type: member.type ? member.type.getText(sourceFile) : "unknown"
      });
    }
    return fields;
  }

  private extractClassMethods(node: ts.ClassDeclaration, sourceFile: ts.SourceFile) {
    const methods: Array<{ name: string; signature: string }> = [];
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member) || !member.name) continue;
      const name = this.getNameText(member.name, sourceFile);
      methods.push({
        name,
        signature: this.formatSignature(member, sourceFile)
      });
    }
    return methods;
  }

  private extractFunctionSignature(node: ts.FunctionDeclaration, sourceFile: ts.SourceFile) {
    return this.formatSignature(node, sourceFile);
  }

  private formatSignature(
    node: ts.FunctionDeclaration | ts.MethodDeclaration,
    sourceFile: ts.SourceFile
  ): string {
    const params = node.parameters.map((param) => {
      const name = param.name.getText(sourceFile);
      const type = param.type ? param.type.getText(sourceFile) : "unknown";
      return `${name}: ${type}`;
    });
    const returnType = node.type ? node.type.getText(sourceFile) : "void";
    return `(${params.join(", ")}) => ${returnType}`;
  }

  private getNameText(name: ts.PropertyName, sourceFile: ts.SourceFile): string {
    if (ts.isIdentifier(name)) return name.text;
    return name.getText(sourceFile).replace(/['"`]/g, "");
  }
}
