import { AdaptiveFlowMetrics } from "../src/utils/AdaptiveFlowMetrics.js";
import { AstManager } from "../src/ast/AstManager.js";
import { FeatureFlags } from "../src/config/FeatureFlags.js";
import * as fs from "fs";
import * as path from "path";

interface TopologyStats {
    successRate: number;
    fallbackRate: number;
    avgDurationMs: number;
    totalScans: number;
}

const fixtures = [
    {
        path: "benchmarks/test-fixtures/sample.ts",
        content: `
import { readFileSync } from "fs";

export class Service {
    constructor(private readonly name: string) {}
    run(): string {
        return readFileSync("README.md", "utf-8") + this.name;
    }
}
`
    },
    {
        path: "benchmarks/test-fixtures/sample-service.py",
        content: `
import os
import sys
from datetime import datetime

class SampleService:
    def __init__(self, name: str):
        self.name = name

    def process(self, data: dict) -> bool:
        print(f"Processing {data} at {datetime.now()}")
        return True
`
    },
    {
        path: "benchmarks/test-fixtures/main.go",
        content: `
package main

import (
    "fmt"
)

func main() {
    fmt.Println("Hello")
}
`
    },
    {
        path: "benchmarks/test-fixtures/lib.rs",
        content: `
pub struct Processor {
    pub id: u32,
}

impl Processor {
    pub fn run(&self) {}
}
`
    },
    {
        path: "benchmarks/test-fixtures/Service.java",
        content: `
package com.example;

public class Service {
    public void execute() {}
}
`
    },
    {
        path: "benchmarks/test-fixtures/index.php",
        content: `
<?php
class Controller {
    public function handle($request) {
        return "Handling " . $request;
    }
}
`
    }
];

const resetMetrics = () => {
    (AdaptiveFlowMetrics as any).metrics = {
        lod_promotions: { l0_to_l1: 0, l1_to_l2: 0, l2_to_l3: 0 },
        topology_scanner: { success_count: 0, fallback_count: 0, total_time_ms: 0 },
        ucg: { node_count: 0, evictions: 0, cascade_invalidations: 0, memory_estimate_mb: 0 }
    };
};

const ensureFixtures = () => {
    const dir = path.join("benchmarks", "test-fixtures");
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fixtures.forEach(fixture => {
        fs.writeFileSync(fixture.path, fixture.content.trim() + "\n");
    });
};

const cleanupFixtures = () => {
    fixtures.forEach(fixture => {
        if (fs.existsSync(fixture.path)) {
            fs.unlinkSync(fixture.path);
        }
    });
};

const toStats = (): TopologyStats => {
    const metrics = AdaptiveFlowMetrics.getMetrics();
    const totalScans = metrics.topology_scanner.success_count + metrics.topology_scanner.fallback_count;
    return {
        successRate: metrics.topology_scanner.success_rate,
        fallbackRate: metrics.topology_scanner.fallback_rate,
        avgDurationMs: metrics.topology_scanner.avg_duration_ms,
        totalScans
    };
};

async function run(): Promise<void> {
    const iterations = Number.parseInt(process.env.SMART_CONTEXT_TOPOLOGY_ITERATIONS ?? "50", 10);
    const astManager = AstManager.getInstance();
    await astManager.init();

    process.env.SMART_CONTEXT_UNIFIED_EXTRACTION_ENABLED = "true";
    process.env.SMART_CONTEXT_TOPOLOGY_SCANNER_ENABLED = "true";
    FeatureFlags.set(FeatureFlags.UNIFIED_EXTRACTION_ENABLED, true);
    FeatureFlags.set(FeatureFlags.TOPOLOGY_SCANNER_ENABLED, true);

    ensureFixtures();
    resetMetrics();

    for (let i = 0; i < iterations; i += 1) {
        for (const fixture of fixtures) {
            await astManager.extractUniversalTopology(fixture.path, fixture.content);
        }
    }

    const stats = toStats();
    const reportLines = [
        "# Query-based Extraction Metrics",
        "",
        `Iterations: ${iterations}`,
        `Files: ${fixtures.length}`,
        "",
        "| Metric | Value |",
        "| --- | --- |",
        `| Success rate | ${(stats.successRate * 100).toFixed(2)}% |`,
        `| Fallback rate | ${(stats.fallbackRate * 100).toFixed(2)}% |`,
        `| Avg duration (ms) | ${stats.avgDurationMs.toFixed(2)} |`,
        `| Total scans | ${stats.totalScans} |`
    ];

    const reportDir = path.join(process.cwd(), "benchmarks", "reports");
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `query-extraction-metrics-${Date.now()}.md`);
    fs.writeFileSync(reportPath, reportLines.join("\n"), "utf8");

    console.log(reportLines.join("\n"));
    console.log(`\nReport saved to ${reportPath}`);

    cleanupFixtures();
    await astManager.dispose();
    process.exit(0);
}

run().catch(error => {
    console.error("Benchmark failed:", error);
    cleanupFixtures();
    process.exit(1);
});
