import { SkeletonGenerator } from "../src/ast/SkeletonGenerator.js";
import { AstManager } from "../src/ast/AstManager.js";
import * as fs from "fs";
import * as path from "path";

interface ReductionResult {
    path: string;
    originalTokens: number;
    skeletonTokens: number;
    reduction: number;
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

import "fmt"

type Server struct {
    Addr string
}

func (s *Server) Start() {
    fmt.Println("Starting", s.Addr)
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

const countTokens = (content: string): number => {
    const matches = content.trim().match(/\S+/g);
    return matches ? matches.length : 0;
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

async function run(): Promise<void> {
    const astManager = AstManager.getInstance();
    await astManager.init();
    const generator = new SkeletonGenerator(astManager);

    ensureFixtures();

    const results: ReductionResult[] = [];
    for (const fixture of fixtures) {
        const skeleton = await generator.generateSkeleton(fixture.path, fixture.content);
        const originalTokens = countTokens(fixture.content);
        const skeletonTokens = countTokens(skeleton);
        const reduction = originalTokens > 0 ? 1 - skeletonTokens / originalTokens : 0;
        results.push({
            path: fixture.path,
            originalTokens,
            skeletonTokens,
            reduction
        });
    }

    const avgReduction = results.reduce((sum, r) => sum + r.reduction, 0) / Math.max(1, results.length);
    const reportLines = [
        "# Skeleton Token Reduction",
        "",
        "| File | Original tokens | Skeleton tokens | Reduction |",
        "| --- | --- | --- | --- |",
        ...results.map(result => [
            `| ${result.path}`,
            result.originalTokens,
            result.skeletonTokens,
            `${(result.reduction * 100).toFixed(2)}% |`
        ].join(" | ")),
        "",
        `Average reduction: ${(avgReduction * 100).toFixed(2)}%`
    ];

    const reportDir = path.join(process.cwd(), "benchmarks", "reports");
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `skeleton-token-reduction-${Date.now()}.md`);
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
