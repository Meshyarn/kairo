import { createRequire } from "module";
import * as crypto from "crypto";

const require = createRequire(import.meta.url);
let importedXxhash: any = null;
try {
  importedXxhash = require("xxhashjs");
} catch {
  importedXxhash = null;
}
const XXH: any = importedXxhash ? (importedXxhash.default ?? importedXxhash) : null;

export function computeHash(content: string, algorithm: "sha256" | "xxhash" = "sha256"): string {
  if (algorithm === "xxhash" && XXH) {
    return XXH.h64(0xABCD).update(content).digest().toString(16);
  }
  return crypto.createHash("sha256").update(content).digest("hex");
}
