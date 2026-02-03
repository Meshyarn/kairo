import type { CapabilityProvider } from "../EngineManager.js";
import type { IFileScanProvider } from "../FileScan.js";
import { scanForMatches } from "../../../engine/search/SearchScanner.js";
import { metrics } from "../../../utils/MetricsCollector.js";

export class JsFileScanProvider implements CapabilityProvider<IFileScanProvider> {
    meta = { id: "JsFileScanProvider", tier: "js" as const, priority: 10 };

    isAvailable(): boolean {
        return true;
    }

    get(): IFileScanProvider {
        return {
            scanForMatches: async (args) => {
                const stop = metrics.startTimer("search.scan.js_ms");
                try {
                    return await scanForMatches(args);
                } finally {
                    stop();
                }
            }
        };
    }
}
