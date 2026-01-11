import { describe, it, expect, jest } from "@jest/globals";
import { ProjectSketchBuilder } from "../../generation/project-sketch-builder.js";

describe("ProjectSketchBuilder", () => {
    it("builds a sketch with summary, top modules, and visuals", async () => {
        const dependencyGraph = {
            ensureBuilt: jest.fn<any>().mockResolvedValue(undefined),
            listAllEdges: jest.fn().mockReturnValue([
                { from: "src/a.ts", to: "src/b.ts", type: "import" },
                { from: "src/b.ts", to: "src/c.ts", type: "import" }
            ]),
            getIndexStatus: jest.fn<any>().mockResolvedValue({
                global: { indexedFiles: 3, totalFiles: 3 }
            })
        } as any;

        const builder = new ProjectSketchBuilder(dependencyGraph, undefined, {
            maxTopModules: 2,
            maxEdges: 2,
            includeAscii: true,
            includeMermaid: true
        });

        const sketch = await builder.build();

        expect(dependencyGraph.ensureBuilt).toHaveBeenCalled();
        expect(sketch.summary).toContain("Files indexed: 3.");
        expect(sketch.topModules.length).toBeGreaterThan(0);
        expect(sketch.ascii).toContain("Project Sketch");
        expect(sketch.mermaid).toContain("flowchart LR");
    });

    it("respects output format flags", async () => {
        const dependencyGraph = {
            ensureBuilt: jest.fn<any>().mockResolvedValue(undefined),
            listAllEdges: jest.fn().mockReturnValue([
                { from: "src/a.ts", to: "src/b.ts", type: "import" }
            ]),
            getIndexStatus: jest.fn<any>().mockResolvedValue({
                global: { indexedFiles: 2, totalFiles: 2 }
            })
        } as any;

        const builder = new ProjectSketchBuilder(dependencyGraph, undefined, {
            includeAscii: false,
            includeMermaid: false
        });

        const sketch = await builder.build();

        expect(sketch.ascii).toBeUndefined();
        expect(sketch.mermaid).toBeUndefined();
    });
});
