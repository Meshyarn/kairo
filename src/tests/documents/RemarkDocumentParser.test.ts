import { describe, it, expect } from "@jest/globals";
import { parseMarkdownWithRemark } from "../../documents/RemarkDocumentParser.js";

describe("RemarkDocumentParser", () => {
    it("extracts headings and links including references", () => {
        const content = [
            "# Title",
            "",
            "See [OpenAI](https://openai.com).",
            "",
            "Ref [Docs][docs].",
            "",
            "[docs]: https://example.com/docs"
        ].join("\n");

        const result = parseMarkdownWithRemark(content, "markdown");
        if (!result) {
            expect(result).toBeNull();
            return;
        }
        expect(result.headings[0].title).toBe("Title");
        expect(result.links.some(link => link.href.includes("openai.com"))).toBe(true);
        expect(result.links.some(link => link.href.includes("example.com/docs"))).toBe(true);
    });

    it("parses MDX content when requested", () => {
        const content = "# MDX Title\n\n<Callout>Hi</Callout>\n";
        const result = parseMarkdownWithRemark(content, "mdx");
        if (!result) {
            expect(result).toBeNull();
            return;
        }
        expect(result.headings[0].title).toBe("MDX Title");
    });
});
