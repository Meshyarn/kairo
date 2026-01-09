import { describe, it, expect } from "@jest/globals";
import { buildUnderstandResponse } from "../../orchestration/pillars/understand/ReportGenerator.js";

describe("buildUnderstandResponse", () => {
  it("marks partial_success when call graph is requested without symbol", () => {
    const response = buildUnderstandResponse({
      subject: "foo",
      filePath: "src/foo.ts",
      symbolName: null,
      skeleton: "",
      profile: { metadata: { lineCount: 10 } },
      isDocument: false,
      includeCalls: true,
      degraded: false,
      budget: {},
      allowGraphs: true
    });

    expect(response.status).toBe("partial_success");
    expect(response.guidance.message).toContain("Call graph skipped");
  });

  it("uses document guidance when graph analysis is blocked for docs", () => {
    const response = buildUnderstandResponse({
      subject: "doc",
      filePath: "README.md",
      symbolName: null,
      skeleton: "",
      profile: { metadata: { lineCount: 5 } },
      isDocument: true,
      includeCalls: false,
      degraded: true,
      refinementReason: "document_file",
      budget: {},
      allowGraphs: false
    });

    expect(response.guidance.message).toContain("Document structure analyzed");
  });
});
