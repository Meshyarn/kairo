
import { AstManager } from '../src/ast/AstManager.js';
import { FeatureFlags } from '../src/config/FeatureFlags.js';
import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';

async function runBenchmark() {
    console.log("============================================================");
    console.log("Multi-Language LOD Performance Benchmark");
    console.log("============================================================");

    const astManager = AstManager.getInstance();
    await astManager.init();

    // Enable adaptive flow for LOD 1 testing
    const context = FeatureFlags.getContext();
    process.env.SMART_CONTEXT_ADAPTIVE_FLOW_ENABLED = 'true';
    process.env.SMART_CONTEXT_TOPOLOGY_SCANNER_ENABLED = 'true';

    const testFiles = [
        // TypeScript
        { path: 'benchmarks/test-fixtures/sample.ts', lang: 'typescript', content: `
import { readFileSync } from "fs";

export class Service {
    constructor(private readonly name: string) {}
    run(): string {
        return readFileSync("README.md", "utf-8") + this.name;
    }
}
` },
        // Python
        { path: 'benchmarks/test-fixtures/sample-service.py', lang: 'python', content: `
import os
import sys
from datetime import datetime

class SampleService:
    def __init__(self, name: str):
        self.name = name
    
    def process(self, data: dict) -> bool:
        """Process data."""
        print(f"Processing {data} at {datetime.now()}")
        return True

def main():
    service = SampleService("Benchmark")
    service.process({"key": "value"})

if __name__ == "__main__":
    main()
` },
        // Go
        { path: 'benchmarks/test-fixtures/main.go', lang: 'go', content: `
package main

import (
	"fmt"
	"net/http"
)

type Server struct {
	Addr string
}

func (s *Server) Start() error {
	fmt.Printf("Starting server at %s\\n", s.Addr)
	return http.ListenAndServe(s.Addr, nil)
}

func main() {
	srv := &Server{Addr: ":8080"}
	srv.Start()
}
` },
        // Rust
        { path: 'benchmarks/test-fixtures/lib.rs', lang: 'rust', content: `
use std::collections::HashMap;

pub struct processor {
    pub id: u32,
}

impl processor {
    pub fn new(id: u32) -> self {
        self { id }
    }

    pub fn process(&self, data: &str) -> result<(), string> {
        println!("processing: {}", data);
        ok(())
    }
}

pub fn run() {
    let p = processor::new(1);
    let _ = p.process("test");
}
` },
        // Java
        { path: 'benchmarks/test-fixtures/Service.java', lang: 'java', content: `
package com.example;
import java.util.*;

public class Service {
    private String name;
    public Service(String name) { this.name = name; }
    public void execute() {
        System.out.println("Executing " + name);
    }
    public static void main(String[] args) {
        new Service("Java").execute();
    }
}
` },
        // PHP
        { path: 'benchmarks/test-fixtures/index.php', lang: 'php', content: `
<?php
namespace App;
use Exception;

class Controller {
    public function handle($request) {
        return "Handling " . $request;
    }
}
` }
    ];

    // Ensure fixtures directory exists
    if (!fs.existsSync('benchmarks/test-fixtures')) {
        fs.mkdirSync('benchmarks/test-fixtures', { recursive: true });
    }

    for (const file of testFiles) {
        fs.writeFileSync(file.path, file.content);
        
        console.log(`\nBenchmarking ${file.lang.toUpperCase()} (${file.path})...`);
        
        // Warmup
        await astManager.parseFile(file.path, file.content);
        
        // 1. Full AST (LOD 3)
        const startFull = performance.now();
        const iterations = 100;
        for (let i = 0; i < iterations; i++) {
            await astManager.fallbackToFullAST(file.path);
        }
        const endFull = performance.now();
        const avgFull = (endFull - startFull) / iterations;
        
        // 2. Topology Scan (LOD 1)
        const startLOD = performance.now();
        for (let i = 0; i < iterations; i++) {
            await astManager.extractUniversalTopology(file.path, file.content);
        }
        const endLOD = performance.now();
        const avgLOD = (endLOD - startLOD) / iterations;

        console.log(`  Full AST (LOD 3) Avg: ${avgFull.toFixed(3)}ms`);
        console.log(`  Topology Scan (LOD 1) Avg: ${avgLOD.toFixed(3)}ms`);
        console.log(`  Improvement: ${(avgFull / avgLOD).toFixed(2)}x`);
        
        if (avgLOD <= 5.0) {
            console.log(`  Status: PASS (<= 5ms)`);
        } else {
            console.log(`  Status: FAIL (> 5ms)`);
        }
    }

    // Cleanup
    testFiles.forEach(f => {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
    });

    await astManager.dispose();
    console.log("\nBenchmark completed successfully.");
    process.exit(0);
}

runBenchmark().catch(console.error);
