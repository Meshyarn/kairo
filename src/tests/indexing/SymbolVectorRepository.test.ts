import { describe, it, expect } from "@jest/globals";
import { SymbolVectorRepository } from "../../indexing/SymbolVectorRepository.js";

describe("SymbolVectorRepository symbolId", () => {
  it("builds and parses symbol ids", () => {
    const id = SymbolVectorRepository.buildSymbolId({
      filePath: "src/example.ts",
      name: "computeValue",
      type: "function",
      lineRange: { start: 10, end: 20 },
      range: { startByte: 0, endByte: 0 }
    });
    const parsed = SymbolVectorRepository.parseSymbolId(id);
    expect(parsed).toBeDefined();
    expect(parsed?.filePath).toBe("src/example.ts");
    expect(parsed?.lineRange).toEqual({ start: 10, end: 20 });
    expect(parsed?.type).toBe("function");
    expect(parsed?.name).toBe("computeValue");
  });
});
