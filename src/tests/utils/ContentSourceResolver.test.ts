import { describe, it, expect } from "@jest/globals";
import { MemoryFileSystem } from "../../platform/FileSystem.js";
import { FlowArtifactManager } from "../../orchestration/flow-artifact-manager.js";
import { resolveContentSource } from "../../utils/ContentSourceResolver.js";

describe("ContentSourceResolver", () => {
  it("resolves inline content", async () => {
    const fs = new MemoryFileSystem("/root");
    const result = await resolveContentSource(
      { kind: "inline", text: "hello" },
      { rootPath: "/root", fileSystem: fs }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe("hello");
    }
  });

  it("resolves base64 content", async () => {
    const fs = new MemoryFileSystem("/root");
    const payload = "line1\nline2";
    const base64 = Buffer.from(payload, "utf8").toString("base64");
    const result = await resolveContentSource(
      { kind: "base64", base64 },
      { rootPath: "/root", fileSystem: fs }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe(payload);
    }
  });

  it("allows temp file source even if ignored", async () => {
    const fs = new MemoryFileSystem("/root");
    await fs.writeFile(".kairo/tmp/raw.txt", "temp");

    const result = await resolveContentSource(
      { kind: "file", path: ".kairo/tmp/raw.txt" },
      { rootPath: "/root", fileSystem: fs, ignoreGlobs: ["**/*"] }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe("temp");
    }
  });

  it("blocks internal .kairo files outside temp", async () => {
    const fs = new MemoryFileSystem("/root");
    await fs.writeFile(".kairo/secret.txt", "nope");

    const result = await resolveContentSource(
      { kind: "file", path: ".kairo/secret.txt" },
      { rootPath: "/root", fileSystem: fs }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.errorCode).toBe("CONTENT_SOURCE_BLOCKED");
    }
  });

  it("resolves artifact content", async () => {
    const fs = new MemoryFileSystem("/root");
    const manager = new FlowArtifactManager({ fileSystem: fs });
    const artifactId = manager.store({
      id: "artifact-1",
      type: "analysis",
      createdAt: Date.now(),
      content: "artifact-body"
    } as any);

    const result = await resolveContentSource(
      { kind: "artifact", id: artifactId },
      { rootPath: "/root", fileSystem: fs, artifactManager: manager }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe("artifact-body");
    }
  });
});
