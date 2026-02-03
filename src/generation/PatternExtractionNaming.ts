import type { NamingPattern } from "./PatternExtractor.js";

export const extractNamingPatterns = (
    content: string,
    collections: {
        functionNames: string[];
        classNames: string[];
        interfaceNames: string[];
        variableNames: string[];
        constantNames: string[];
    }
): void => {
    const lines = content.split("\n");

    for (const line of lines) {
        const trimmed = line.trim();

        // function functionName
        const funcMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
        if (funcMatch) {
            collections.functionNames.push(funcMatch[1]);
        }

        // class ClassName
        const classMatch = trimmed.match(/^(?:export\s+)?class\s+(\w+)/);
        if (classMatch) {
            collections.classNames.push(classMatch[1]);
        }

        // interface InterfaceName
        const interfaceMatch = trimmed.match(/^(?:export\s+)?interface\s+(\w+)/);
        if (interfaceMatch) {
            collections.interfaceNames.push(interfaceMatch[1]);
        }

        // const CONSTANT_NAME =
        const constMatch = trimmed.match(/^(?:export\s+)?const\s+(\w+)\s*=/);
        if (constMatch) {
            const name = constMatch[1];
            if (name === name.toUpperCase()) {
                collections.constantNames.push(name);
            } else {
                collections.variableNames.push(name);
            }
        }

        // let variableName =
        const letMatch = trimmed.match(/^(?:export\s+)?let\s+(\w+)\s*=/);
        if (letMatch) {
            collections.variableNames.push(letMatch[1]);
        }
    }
};

export const detectNamingConventions = (collections: {
    functionNames: string[];
    classNames: string[];
    interfaceNames: string[];
    variableNames: string[];
    constantNames: string[];
}): NamingPattern[] => {
    const patterns: NamingPattern[] = [];

    if (collections.functionNames.length > 0) {
        const convention = detectConvention(collections.functionNames);
        patterns.push({
            type: "function",
            convention,
            confidence: calculateConfidence(collections.functionNames, convention),
            samples: collections.functionNames.slice(0, 5)
        });
    }

    if (collections.classNames.length > 0) {
        const convention = detectConvention(collections.classNames);
        patterns.push({
            type: "class",
            convention,
            confidence: calculateConfidence(collections.classNames, convention),
            samples: collections.classNames.slice(0, 5)
        });
    }

    if (collections.interfaceNames.length > 0) {
        const convention = detectConvention(collections.interfaceNames);
        patterns.push({
            type: "interface",
            convention,
            confidence: calculateConfidence(collections.interfaceNames, convention),
            samples: collections.interfaceNames.slice(0, 5)
        });
    }

    if (collections.variableNames.length > 0) {
        const convention = detectConvention(collections.variableNames);
        patterns.push({
            type: "variable",
            convention,
            confidence: calculateConfidence(collections.variableNames, convention),
            samples: collections.variableNames.slice(0, 5)
        });
    }

    if (collections.constantNames.length > 0) {
        const convention = detectConvention(collections.constantNames);
        patterns.push({
            type: "constant",
            convention,
            confidence: calculateConfidence(collections.constantNames, convention),
            samples: collections.constantNames.slice(0, 5)
        });
    }

    return patterns;
};

const detectConvention = (
    names: string[]
): "camelCase" | "PascalCase" | "UPPER_CASE" | "kebab-case" | "snake_case" => {
    const conventions = {
        camelCase: 0,
        PascalCase: 0,
        UPPER_CASE: 0,
        "kebab-case": 0,
        snake_case: 0
    };

    for (const name of names) {
        if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
            conventions.PascalCase++;
        } else if (/^[a-z][a-zA-Z0-9]*$/.test(name)) {
            conventions.camelCase++;
        } else if (/^[A-Z][A-Z0-9_]*$/.test(name)) {
            conventions.UPPER_CASE++;
        } else if (/^[a-z][a-z0-9-]*$/.test(name)) {
            conventions["kebab-case"]++;
        } else if (/^[a-z][a-z0-9_]*$/.test(name)) {
            conventions.snake_case++;
        }
    }

    let maxCount = 0;
    let detected: keyof typeof conventions = "camelCase";

    for (const [convention, count] of Object.entries(conventions)) {
        if (count > maxCount) {
            maxCount = count;
            detected = convention as keyof typeof conventions;
        }
    }

    return detected;
};

const calculateConfidence = (names: string[], convention: string): number => {
    if (names.length === 0) return 0;

    let matches = 0;
    for (const name of names) {
        if (matchesConvention(name, convention)) {
            matches++;
        }
    }

    return matches / names.length;
};

const matchesConvention = (name: string, convention: string): boolean => {
    switch (convention) {
        case "camelCase":
            return /^[a-z][a-zA-Z0-9]*$/.test(name);
        case "PascalCase":
            return /^[A-Z][a-zA-Z0-9]*$/.test(name);
        case "UPPER_CASE":
            return /^[A-Z][A-Z0-9_]*$/.test(name);
        case "kebab-case":
            return /^[a-z][a-z0-9-]*$/.test(name);
        case "snake_case":
            return /^[a-z][a-z0-9_]*$/.test(name);
        default:
            return false;
    }
};
