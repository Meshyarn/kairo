import { describe, expect, it } from "@jest/globals";
import { TextNormalizer } from "../../utils/textNormalization.js";

describe("TextNormalizer", () => {
  it("unescapes newlines outside of quotes", () => {
    const input = "line1\\nline2";
    const output = TextNormalizer.normalizeForFileSystem(input);
    expect(output).toBe("line1\nline2");
  });

  it("preserves escaped sequences inside quotes", () => {
    const input = "const message = \"Hello\\nWorld\";";
    const output = TextNormalizer.normalizeForFileSystem(input);
    expect(output).toContain("\\n");
  });

  it("normalizes to target line endings and trims trailing spaces", () => {
    const input = "line1  \nline2\t\n";
    const output = TextNormalizer.normalizeForFileSystem(input, {
      trimTrailing: true,
      targetEOL: "\r\n"
    });
    expect(output).toBe("line1\r\nline2\r\n");
  });
});
