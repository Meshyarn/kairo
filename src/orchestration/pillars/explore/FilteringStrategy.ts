import path from "path";

export const DOC_EXTENSIONS = new Set([
    ".md", ".mdx", ".txt", ".log", ".docx", ".xlsx", ".pdf", ".html", ".htm", ".css"
]);
export const LOG_EXTENSIONS = new Set([".log"]);

export const SENSITIVE_FILENAMES = new Set([
    ".env",
    "id_rsa",
    "id_ed25519",
    "known_hosts",
    "authorized_keys"
]);

export const SENSITIVE_EXTENSIONS = new Set([
    ".pem",
    ".p12",
    ".pfx",
    ".key",
    ".kdbx"
]);

export const SENSITIVE_DIRS = new Set([".ssh", ".gnupg"]);

export const BINARY_EXTENSIONS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".ico",
    ".zip",
    ".tar",
    ".gz",
    ".7z",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".class",
    ".jar"
]);

const DEFAULT_SOFT_PRIORITY_RATIO = 0.2;

export function isGlob(value: string): boolean {
    return /[*?[\]{}]/.test(value);
}

export function isDocPath(filePath: string): boolean {
    return DOC_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function isLogPath(filePath?: string): boolean {
    if (!filePath) return false;
    return LOG_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function isSensitivePath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, "/");
    const segments = normalized.split("/");
    if (segments.some(segment => SENSITIVE_DIRS.has(segment))) return true;

    const base = path.basename(normalized);
    if (SENSITIVE_FILENAMES.has(base)) return true;
    if (base.startsWith(".env")) return true;

    const ext = path.extname(base).toLowerCase();
    if (SENSITIVE_EXTENSIONS.has(ext)) return true;

    return false;
}

export function isBinaryPath(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    if (DOC_EXTENSIONS.has(ext)) return false;
    return BINARY_EXTENSIONS.has(ext);
}

export function applySoftPriority(
    entries: Array<{ path: string; mtime?: number; size?: number }>,
    maxFiles: number,
    includeDocs: boolean,
    includeCode: boolean
): Array<{ path: string; mtime?: number; size?: number }> {
    const sorted = entries.slice().sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
    if (!includeDocs && !includeCode) return [];

    const preferred = sorted.filter(entry => {
        if (includeDocs && includeCode) return isDocPath(entry.path);
        if (includeDocs) return isDocPath(entry.path);
        return !isDocPath(entry.path);
    });

    const preferredQuota = Math.min(Math.floor(maxFiles * DEFAULT_SOFT_PRIORITY_RATIO), preferred.length);
    const selected: Array<{ path: string; mtime?: number; size?: number }> = [];
    const seen = new Set<string>();

    for (let i = 0; i < preferredQuota; i += 1) {
        const entry = preferred[i];
        if (!entry) continue;
        selected.push(entry);
        seen.add(entry.path);
    }

    for (const entry of sorted) {
        if (selected.length >= maxFiles) break;
        if (seen.has(entry.path)) continue;
        selected.push(entry);
        seen.add(entry.path);
    }

    return selected;
}
