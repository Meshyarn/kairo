import { jest, describe, it, expect } from "@jest/globals";
import { DocumentProfiler } from "../../documents/DocumentProfiler.js";

const sample = `---
title: Sample Doc
---
# Intro
## Setup
### Details
## Usage
`;

jest.setTimeout(20000);

describe("DocumentProfiler options", () => {
    it("respects maxDepth and frontmatter flag", async () => {
        const profiler = new DocumentProfiler(process.cwd());
        const profile = await profiler.profile({
            filePath: "docs/sample.md",
            content: sample,
            kind: "markdown",
            options: { maxDepth: 2, includeFrontmatter: false }
        });

        expect(profile.frontmatter).toBeUndefined();
        expect(profile.outline.map(section => section.title)).toEqual(["Intro", "Setup", "Usage"]);
    });
});
