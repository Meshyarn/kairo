import * as fs from "fs";
import * as path from "path";
import type { IMetricsExporter, MetricsExportPayload } from "../IMetricsExporter.js";

export class JsonlExporter implements IMetricsExporter {
    name = "jsonl";
    private readonly logPath: string;

    constructor(logPath: string) {
        this.logPath = logPath;
    }

    async export(payload: MetricsExportPayload): Promise<void> {
        const dir = path.dirname(this.logPath);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.appendFile(this.logPath, `${JSON.stringify(payload)}\n`, "utf8");
    }
}
