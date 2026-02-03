import type { ExportPattern, ImportPattern } from "./PatternExtractor.js";

export const extractImportPatterns = (content: string, imports: Map<string, ImportPattern>): void => {
    const lines = content.split("\n");

    for (const line of lines) {
        const trimmed = line.trim();

        // import { x, y } from 'module'
        const namedMatch = trimmed.match(/^import\s+{([^}]+)}\s+from\s+['"]([^'"]+)['"]/);
        if (namedMatch) {
            const namedImports = namedMatch[1].split(",").map(s => s.trim());
            const module = namedMatch[2];
            const key = `named:${module}`;

            if (imports.has(key)) {
                imports.get(key)!.count++;
            } else {
                imports.set(key, {
                    module,
                    style: "named",
                    namedImports,
                    count: 1
                });
            }
            continue;
        }

        // import x from 'module'
        const defaultMatch = trimmed.match(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
        if (defaultMatch) {
            const alias = defaultMatch[1];
            const module = defaultMatch[2];
            const key = `default:${module}`;

            if (imports.has(key)) {
                imports.get(key)!.count++;
            } else {
                imports.set(key, {
                    module,
                    style: "default",
                    alias,
                    count: 1
                });
            }
            continue;
        }

        // import * as x from 'module'
        const namespaceMatch = trimmed.match(/^import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
        if (namespaceMatch) {
            const alias = namespaceMatch[1];
            const module = namespaceMatch[2];
            const key = `namespace:${module}`;

            if (imports.has(key)) {
                imports.get(key)!.count++;
            } else {
                imports.set(key, {
                    module,
                    style: "namespace",
                    alias,
                    count: 1
                });
            }
            continue;
        }

        // import 'module'
        const sideEffectMatch = trimmed.match(/^import\s+['"]([^'"]+)['"]/);
        if (sideEffectMatch) {
            const module = sideEffectMatch[1];
            const key = `side-effect:${module}`;

            if (imports.has(key)) {
                imports.get(key)!.count++;
            } else {
                imports.set(key, {
                    module,
                    style: "side-effect",
                    count: 1
                });
            }
        }
    }
};

export const extractExportPatterns = (content: string, exports: Map<string, ExportPattern>): void => {
    const lines = content.split("\n");

    for (const line of lines) {
        const trimmed = line.trim();

        // export { x, y }
        const namedMatch = trimmed.match(/^export\s+{([^}]+)}/);
        if (namedMatch) {
            const exportedNames = namedMatch[1].split(",").map(s => s.trim());
            const key = "named";

            if (exports.has(key)) {
                exports.get(key)!.count++;
            } else {
                exports.set(key, {
                    style: "named",
                    exportedNames,
                    count: 1
                });
            }
            continue;
        }

        // export default X
        if (trimmed.startsWith("export default ")) {
            const key = "default";

            if (exports.has(key)) {
                exports.get(key)!.count++;
            } else {
                exports.set(key, {
                    style: "default",
                    exportedNames: ["default"],
                    count: 1
                });
            }
            continue;
        }

        // export * from 'module'
        if (trimmed.match(/^export\s+\*\s+from/)) {
            const key = "namespace";

            if (exports.has(key)) {
                exports.get(key)!.count++;
            } else {
                exports.set(key, {
                    style: "namespace",
                    exportedNames: ["*"],
                    count: 1
                });
            }
        }
    }
};
