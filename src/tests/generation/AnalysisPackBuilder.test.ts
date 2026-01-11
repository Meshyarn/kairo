import { describe, it, expect } from "@jest/globals";
import { AnalysisPackBuilder } from "../../generation/analysis-pack-builder.js";

describe("AnalysisPackBuilder", () => {
    it("builds clusters from primary, dependencies, hotspots, and search results", () => {
        const builder = new AnalysisPackBuilder({ maxClusters: 3, maxFilesPerCluster: 3 });
        const pack = builder.build({
            goal: "Analyze payment flow",
            primaryFile: "src/payments/PaymentService.ts",
            dependencyEdges: [
                { from: "src/payments/PaymentService.ts", to: "src/payments/PaymentRepository.ts" },
                { from: "src/payments/PaymentService.ts", to: "src/utils/Logger.ts" }
            ],
            hotSpots: [
                { path: "src/payments/PaymentService.ts", score: 0.9, reason: "High churn" },
                { path: "src/payments/PaymentController.ts", score: 0.8 }
            ],
            searchResults: [
                { path: "src/payments/PaymentController.ts", score: 0.7 },
                { path: "src/payments/PaymentRoutes.ts", score: 0.6 }
            ],
            degraded: false
        });

        expect(pack.goal).toBe("Analyze payment flow");
        expect(pack.clusters.length).toBeGreaterThan(0);
        expect(pack.clusters[0].files[0].path).toBe("src/payments/PaymentService.ts");
        expect(pack.degraded).toBe(false);
    });

    it("respects maxFilesPerCluster limits", () => {
        const builder = new AnalysisPackBuilder({ maxClusters: 1, maxFilesPerCluster: 1 });
        const pack = builder.build({
            goal: "Analyze auth",
            primaryFile: "src/auth/AuthService.ts",
            dependencyEdges: [
                { from: "src/auth/AuthService.ts", to: "src/auth/AuthRepository.ts" }
            ],
            searchResults: [
                { path: "src/auth/AuthController.ts", score: 0.5 }
            ],
            degraded: true
        });

        expect(pack.clusters.length).toBe(1);
        expect(pack.clusters[0].files.length).toBe(1);
        expect(pack.clusters[0].files[0].path).toBe("src/auth/AuthService.ts");
    });
});
