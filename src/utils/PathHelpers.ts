import path from 'path';

export function normalizePath(value: string): string {
    const normalized = path.normalize(value);
    return normalized.split(path.sep).join('/');
}

export function toRelativePath(rootPath: string, filePath: string): string {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(rootPath, filePath);
    const relative = path.relative(rootPath, absPath);
    return normalizePath(relative || path.basename(absPath));
}

export function toAbsolutePath(rootPath: string, filePath: string): string {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(rootPath, filePath);
    return normalizePath(absPath);
}

export const PathHelpers = {
    normalize: normalizePath,
    relative: path.relative,
    resolve: path.resolve,
    isAbsolute: path.isAbsolute,
    join: path.join
};
