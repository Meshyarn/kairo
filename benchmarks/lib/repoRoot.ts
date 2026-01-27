import fs from "fs";
import path from "path";

type ResolveRepoRootOptions = {
    cwd?: string;
    fileHint?: string;
};

export function resolveRepoRoot(options: ResolveRepoRootOptions = {}): string {
    const cwd = options.cwd ?? process.cwd();
    const candidates: string[] = [path.resolve(cwd)];

    if (options.fileHint) {
        const resolved = path.resolve(options.fileHint);
        let candidate = resolved;
        try {
            if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
                candidate = path.dirname(resolved);
            }
        } catch {
            // ignore invalid hint
        }
        candidates.push(candidate);
    }

    for (const candidate of candidates) {
        const normalized = path.basename(candidate) === "dist" ? path.dirname(candidate) : candidate;
        const root = findPackageRoot(normalized);
        if (root) {
            return root;
        }
    }

    return path.resolve(cwd);
}

function findPackageRoot(start: string): string | null {
    let current = start;
    while (true) {
        const pkgPath = path.join(current, "package.json");
        if (fs.existsSync(pkgPath)) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}
