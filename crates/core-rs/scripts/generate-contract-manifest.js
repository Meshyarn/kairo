const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const rootPath = process.env.KAIRO_ROOT_PATH || process.env.KAIRO_ROOT || path.resolve(__dirname, "..", "..");
const repoPath = path.resolve(__dirname, "..");
const dtsPath = path.join(repoPath, "index.d.ts");
const packageJsonPath = path.join(repoPath, "package.json");

const normalizePackageName = (name) => name.replace(/\//g, "__");

const loadPackageName = () => {
  if (!fs.existsSync(packageJsonPath)) return "@kairo/core-rs";
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    return pkg.name || "@kairo/core-rs";
  } catch {
    return "@kairo/core-rs";
  }
};

const hasExportModifier = (node) =>
  Array.isArray(node.modifiers) && node.modifiers.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword);

const extractInterfaceFields = (node, sourceFile) => {
  const fields = [];
  node.members.forEach((member) => {
    if (!ts.isPropertySignature(member) || !member.name) return;
    const name = member.name.getText(sourceFile).replace(/['"`]/g, "");
    const type = member.type ? member.type.getText(sourceFile) : "unknown";
    fields.push({ name, type });
  });
  return fields;
};

const extractClassMethods = (node, sourceFile) => {
  const methods = [];
  node.members.forEach((member) => {
    if (!ts.isMethodDeclaration(member) || !member.name) return;
    const name = member.name.getText(sourceFile).replace(/['"`]/g, "");
    const params = member.parameters.map((param) => {
      const nameText = param.name.getText(sourceFile);
      const typeText = param.type ? param.type.getText(sourceFile) : "unknown";
      return `${nameText}: ${typeText}`;
    });
    const returnType = member.type ? member.type.getText(sourceFile) : "void";
    methods.push({ name, signature: `(${params.join(", ")}) => ${returnType}` });
  });
  return methods;
};

const extractFunctionSignature = (node, sourceFile) => {
  const params = node.parameters.map((param) => {
    const nameText = param.name.getText(sourceFile);
    const typeText = param.type ? param.type.getText(sourceFile) : "unknown";
    return `${nameText}: ${typeText}`;
  });
  const returnType = node.type ? node.type.getText(sourceFile) : "void";
  return `(${params.join(", ")}) => ${returnType}`;
};

const buildManifest = () => {
  if (!fs.existsSync(dtsPath)) {
    throw new Error(`index.d.ts not found at ${dtsPath}`);
  }
  const packageName = loadPackageName();
  const content = fs.readFileSync(dtsPath, "utf-8");
  const sourceFile = ts.createSourceFile(dtsPath, content, ts.ScriptTarget.ES2022, true);

  const exportsMap = {};
  sourceFile.statements.forEach((stmt) => {
    if (!hasExportModifier(stmt)) return;
    if (ts.isInterfaceDeclaration(stmt)) {
      exportsMap[stmt.name.text] = {
        name: stmt.name.text,
        kind: "interface",
        fields: extractInterfaceFields(stmt, sourceFile)
      };
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      exportsMap[stmt.name.text] = {
        name: stmt.name.text,
        kind: "class",
        methods: extractClassMethods(stmt, sourceFile)
      };
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      exportsMap[stmt.name.text] = {
        name: stmt.name.text,
        kind: "function",
        signature: extractFunctionSignature(stmt, sourceFile)
      };
    }
  });

  return {
    header: {
      version: "1.0",
      kind: "ffi_napi",
      id: normalizePackageName(packageName),
      module: packageName,
      sourceRepo: "crates/core-rs",
      generatedAt: Date.now()
    },
    surface: {
      kind: "ffi_napi",
      exports: exportsMap
    }
  };
};

const writeManifest = (manifest) => {
  const outDir = path.join(rootPath, ".kairo", "contracts", "ffi_napi");
  fs.mkdirSync(outDir, { recursive: true });
  const fileName = `${manifest.header.id}.json`;
  const outputPath = path.join(outDir, fileName);
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), "utf-8");
  return outputPath;
};

const main = () => {
  const manifest = buildManifest();
  const outputPath = writeManifest(manifest);
  console.log(`[contract-manifest] wrote ${outputPath}`);
};

main();
