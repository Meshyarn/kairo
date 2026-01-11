import { describe, it, expect } from "@jest/globals";
import { DraftPackBuilder } from "../../generation/draft-pack-builder.js";

describe("DraftPackBuilder", () => {
    it("builds a draft pack with skeleton and phantom diff", async () => {
        const builder = new DraftPackBuilder({ skeletonOnly: true, includePhantomDiff: true });
        const pack = await builder.buildForWrite({
            intent: "add foo",
            targetPath: "src/foo.ts",
            content: "export const foo = 1;\n",
            existingContent: ""
        });

        expect(pack.id).toBeDefined();
        expect(typeof pack.skeleton).toBe("object");
        expect(pack.phantomFiles.length).toBe(1);
        expect(pack.phantomDiffs?.length).toBe(1);
    });
});
