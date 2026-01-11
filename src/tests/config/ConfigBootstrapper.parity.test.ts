import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { ConfigBootstrapper } from "../../config/ConfigBootstrapper.js";

describe("ConfigBootstrapper parity scope", () => {
  it("reports parity findings for missing WASM assets", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-parity-"));
    const previous = process.env.KAIRO_WASM_DIR;
    process.env.KAIRO_WASM_DIR = path.join(root, "missing-wasm");

    try {
      const bootstrapper = new ConfigBootstrapper(root);
      const result = await bootstrapper.doctor({ scope: "parity", mode: "plan" });
      const codes = result.findings.map((finding) => finding.code);
      expect(codes).toContain("MISSING_WASM_GRAMMAR");
    } finally {
      if (previous === undefined) {
        delete process.env.KAIRO_WASM_DIR;
      } else {
        process.env.KAIRO_WASM_DIR = previous;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("classifies L3 as error and L2 as warn", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairo-parity-severity-"));
    const previous = process.env.KAIRO_WASM_DIR;
    process.env.KAIRO_WASM_DIR = path.join(root, "missing-wasm");

    try {
      const bootstrapper = new ConfigBootstrapper(root);
      const result = await bootstrapper.doctor({ scope: "parity", mode: "plan" });
      const wasmFindings = result.findings.filter((finding) => finding.code === "MISSING_WASM_GRAMMAR");
      expect(wasmFindings.some((finding) => finding.severity === "error")).toBe(true);
      expect(wasmFindings.some((finding) => finding.severity === "warn")).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.KAIRO_WASM_DIR;
      } else {
        process.env.KAIRO_WASM_DIR = previous;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
