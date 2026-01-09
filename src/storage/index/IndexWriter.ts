import * as fs from "fs";
import * as path from "path";

export function writeJson(filePath: string, value: unknown): void {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(value));
    fs.renameSync(tmpPath, filePath);
}
