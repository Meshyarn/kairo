import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { SeedFinder } from "../../../engine/ClusterSearch/SeedFinder.js";

const makeMocks = () => {
  return {
    symbolIndex: {
      getAllSymbols: jest.fn().mockImplementation(() => Promise.resolve(new Map()))
    }
  };
};

describe("SeedFinder Branches", () => {
  let finder: SeedFinder;
  let mocks: any;

  beforeEach(() => {
    mocks = makeMocks();
    finder = new SeedFinder(mocks.symbolIndex);
  });

  it("covers findSeeds initial filter branches", async () => {
    expect(await finder.findSeeds({ terms: [], filters: {} } as any)).toEqual([]);
    
    mocks.symbolIndex.getAllSymbols.mockResolvedValue(new Map([
      ["a.ts", [{ name: "A", type: "class" }]]
    ]));
    const seeds = await finder.findSeeds({ terms: [], filters: { file: "a.ts" } } as any);
    expect(seeds).toEqual([]); 
  });

  it("covers scoreMatch scoring branches", async () => {
    const serverAny = finder as any;

    expect(serverAny.scoreMatch("MyClass", ["myclass"]).score).toBe(1);
    expect(serverAny.scoreMatch("MyClass", ["my"]).score).toBe(0.8);
    expect(serverAny.scoreMatch("MyClass", ["class"]).score).toBe(0.5);
    
    // super is part of MySuperClass, so it hits the 'includes' branch (0.5)
    expect(serverAny.scoreMatch("MySuperClass", ["super"]).score).toBe(0.5);

    expect(serverAny.scoreMatch("abc", ["xyz"]).score).toBe(0);
    expect(serverAny.scoreMatch("abc", [""]).score).toBe(0);
  });

  it("covers splitCamelCase patterns", () => {
    const serverAny = finder as any;
    const segments = serverAny.splitCamelCase("MySuper_Class-test");
    expect(segments).toContain("super");
    expect(segments).toContain("class");
    expect(segments).toContain("test");
  });
});
