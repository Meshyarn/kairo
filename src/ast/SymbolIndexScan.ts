import * as path from "path";
import type { IFileSystem } from "../platform/FileSystem.js";

export const scanFiles = (args: {
    dir: string;
    rootPath: string;
    fileSystem: IFileSystem;
    shouldIgnore: (relativePath: string) => boolean;
    isSupported: (filePath: string) => boolean;
}): string[] => {
    let results: string[] = [];
    let list: string[] = [];
    try {
        list = args.fileSystem.readDirSync?.(args.dir) ?? [];
    } catch {
        return [];
    }
    for (const entry of list) {
        const absPath = path.join(args.dir, entry);
        const relPath = path.relative(args.rootPath, absPath);
        if (relPath && args.shouldIgnore(relPath)) {
            continue;
        }
        try {
            const stat = args.fileSystem.statSync?.(absPath);
            if (stat?.isDirectory()) {
                results = results.concat(scanFiles({
                    dir: absPath,
                    rootPath: args.rootPath,
                    fileSystem: args.fileSystem,
                    shouldIgnore: args.shouldIgnore,
                    isSupported: args.isSupported
                }));
            } else if (args.isSupported(absPath)) {
                results.push(absPath);
            }
        } catch {
            continue;
        }
    }
    return results;
};

export const scanFilesAsync = async (args: {
    dir: string;
    rootPath: string;
    fileSystem: IFileSystem;
    shouldIgnore: (relativePath: string) => boolean;
    isSupported: (filePath: string) => boolean;
}): Promise<string[]> => {
    const results: string[] = [];
    const stack: string[] = [args.dir];
    while (stack.length > 0) {
        const current = stack.pop()!;
        let list: string[] = [];
        try {
            list = await args.fileSystem.readDir(current);
        } catch {
            continue;
        }
        for (const entry of list) {
            const absPath = path.join(current, entry);
            const relPath = path.relative(args.rootPath, absPath);
            if (relPath && args.shouldIgnore(relPath)) {
                continue;
            }
            try {
                const stat = await args.fileSystem.stat(absPath);
                if (stat.isDirectory()) {
                    stack.push(absPath);
                } else if (args.isSupported(absPath)) {
                    results.push(absPath);
                }
            } catch {
                continue;
            }
        }
        await yieldToEventLoop();
    }
    return results;
};

export const yieldToEventLoop = async (): Promise<void> => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
};
