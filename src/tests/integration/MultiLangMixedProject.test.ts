import { AstManager } from "../../ast/AstManager.js";

describe("Multi-lang mixed project", () => {
    let astManager: AstManager;

    beforeAll(async () => {
        AstManager.resetForTesting();
        astManager = AstManager.getInstance();
        await astManager.init({ mode: "test", parserBackend: "wasm" });
    });

    afterAll(async () => {
        await AstManager.resetForTestingAsync();
    });

    it("extracts imports across mixed languages without reinitializing", async () => {
        const samples = [
            {
                filePath: "src/app.ts",
                content: `import React, { useState } from "react";
import type { Config } from "./config";
export const App = () => useState(null);`,
                expectedSources: ["react", "./config"]
            },
            {
                filePath: "src/service.py",
                content: `import os
from math import sqrt, pi

def area(r):
    return pi * sqrt(r)`,
                expectedSources: ["os", "math"]
            },
            {
                filePath: "src/main.go",
                content: `package main

import (
    "fmt"
    "net/http"
)

func main() {
    fmt.Println(http.StatusOK)
}`,
                expectedSources: ["fmt", "net/http"]
            },
            {
                filePath: "src/lib.rs",
                content: `use std::collections::HashMap;
use crate::utils::{self, do_work};

pub fn run() { let _ = HashMap::<String, String>::new(); }`,
                expectedSources: ["std::collections", "crate::utils"]
            }
        ];

        for (const sample of samples) {
            const topology = await astManager.extractUniversalTopology(sample.filePath, sample.content);
            const sources = topology.imports.map((entry: { source: string }) => entry.source);
            for (const expected of sample.expectedSources) {
                expect(sources.some((source: string) => source.includes(expected))).toBe(true);
            }
        }
    }, 15000);
});
