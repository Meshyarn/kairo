import path from "path";
import type { FilePattern } from "./PatternExtractor.js";

export const extractFilePatterns = (files: string[]): FilePattern => {
    const fileNames = files.map(f => path.basename(f));
    const directories = files.map(f => path.dirname(f));

    const hasIndex = fileNames.some(f => f.startsWith("index."));
    const hasDotTest = fileNames.some(f => f.includes(".test.") || f.includes(".spec."));
    const hasTestDir = directories.some(d => d.includes("/test") || d.includes("/tests"));

    return {
        fileNamePattern: hasIndex ? "index.*" : "*.ts",
        directoryPattern: findCommonDirectory(directories),
        testPattern: hasDotTest ? "*.test.ts" : hasTestDir ? "tests/*.ts" : undefined
    };
};

export const extractAffixes = (
    collections: {
        functionNames: string[];
        classNames: string[];
        interfaceNames: string[];
    },
    minFrequency: number
): { prefixes: string[]; suffixes: string[] } => {
    const allNames = [
        ...collections.functionNames,
        ...collections.classNames,
        ...collections.interfaceNames
    ];

    const prefixes = new Map<string, number>();
    const suffixes = new Map<string, number>();

    for (const name of allNames) {
        if (name.length > 6) {
            for (let len = 3; len <= 6; len++) {
                const prefix = name.slice(0, len);
                if (/^[A-Z][a-z]{2,}/.test(prefix) || /^[a-z]{3,}/.test(prefix)) {
                    prefixes.set(prefix, (prefixes.get(prefix) || 0) + 1);
                }
            }
        }

        if (name.length > 10) {
            const camelMatches = name.match(/[A-Z][a-z]+/g);
            if (camelMatches && camelMatches.length > 1) {
                const lastPart = camelMatches[camelMatches.length - 1];
                suffixes.set(lastPart, (suffixes.get(lastPart) || 0) + 1);

                if (camelMatches.length > 2) {
                    const lastTwoParts = camelMatches.slice(-2).join("");
                    suffixes.set(lastTwoParts, (suffixes.get(lastTwoParts) || 0) + 1);
                }
            }
        }
    }

    const topPrefixes = Array.from(prefixes.entries())
        .filter(([_, count]) => count >= minFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([prefix]) => prefix);

    const topSuffixes = Array.from(suffixes.entries())
        .filter(([_, count]) => count >= minFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([suffix]) => suffix);

    return {
        prefixes: topPrefixes,
        suffixes: topSuffixes
    };
};

const findCommonDirectory = (directories: string[]): string => {
    if (directories.length === 0) return "";

    const parts = directories[0].split(path.sep);
    let commonParts = [...parts];

    for (let i = 1; i < directories.length; i++) {
        const currentParts = directories[i].split(path.sep);
        const newCommon: string[] = [];

        for (let j = 0; j < Math.min(commonParts.length, currentParts.length); j++) {
            if (commonParts[j] === currentParts[j]) {
                newCommon.push(commonParts[j]);
            } else {
                break;
            }
        }

        commonParts = newCommon;
        if (commonParts.length === 0) break;
    }

    return commonParts.join(path.sep) || ".";
};
