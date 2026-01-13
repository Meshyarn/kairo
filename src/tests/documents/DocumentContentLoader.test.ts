import { describe, it, expect } from "@jest/globals";
import { normalizePdfMarkers, normalizeXlsxMarkers } from "../../documents/DocumentContentLoader.js";

describe("DocumentContentLoader marker normalization", () => {
    it("converts pdf page markers into headings", () => {
        const input = "[[page:1]]\nHello\n[[page:2]]\nWorld";
        const output = normalizePdfMarkers(input);
        expect(output).toContain("# Page 1");
        expect(output).toContain("# Page 2");
    });

    it("converts xlsx sheet markers into headings", () => {
        const input = "[Sheet: Budget]\nHeader: A | B";
        const output = normalizeXlsxMarkers(input);
        expect(output).toContain("# Sheet: Budget");
    });
});
