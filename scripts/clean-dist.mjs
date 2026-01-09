import fs from "fs";
import path from "path";

const distPath = path.resolve("dist");
try {
  if (fs.existsSync(distPath)) {
    fs.rmSync(distPath, { recursive: true, force: true });
  }
} catch (error) {
  console.warn("[clean-dist] Failed to remove dist:", error);
}
