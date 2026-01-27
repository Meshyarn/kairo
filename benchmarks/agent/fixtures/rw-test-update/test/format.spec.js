import { formatPair } from "../src/format.js";

test("formatPair", () => {
  expect(formatPair("env", "prod")).toBe("env: prod");
});
