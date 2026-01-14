import type { IMetricsExporter, MetricsExportPayload } from "../IMetricsExporter.js";

export class StdoutExporter implements IMetricsExporter {
    name = "stdout";

    async export(payload: MetricsExportPayload): Promise<void> {
        console.log(JSON.stringify(payload));
    }
}
