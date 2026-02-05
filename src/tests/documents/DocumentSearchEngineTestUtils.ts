import fs from "fs";
import os from "os";
import path from "path";
import { PathManager } from "../../utils/PathManager.js";

export const SAMPLE_DOCX_BASE64 = "UEsDBBQAAAAIAG9+n1udxYoq8gAAALkBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCE73kKy1eUOHBACCXpgZ8jcCgPsLI3iVV7bXnd0r49TgtFQpSjNfPNrKdb7b0TO0xsA/XyummlQNLBWJp6+b5+ru+k4AxkwAXCXh6Q5WqouvUhIosCE/dyzjneK8V6Rg/chIhUlDEkD7k806Qi6A1MqG7a9lbpQBkp13nJkEMlRPeII2xdFk/7opxuSehYioeTd6nrJcTorIZcdLUj86uo/ippCnn08GwjXxWDVJdKFvFyxw/6WiZK1qB4g5RfwBej+gjJKBP01he4+T/pj2vDOFqNZ35JiyloZC7be9ecFQ+Wvn/RqePwQ/UJUEsDBBQAAAAIAG9+n1tAoFMJsgAAAC8BAAALAAAAX3JlbHMvLnJlbHONz7sOgjAUBuCdp2jOLgUHYwyFxZiwGnyApj2URnpJWy+8vR0cxDg4ntt38jfd08zkjiFqZxnUZQUErXBSW8XgMpw2eyAxcSv57CwyWDBC1xbNGWee8k2ctI8kIzYymFLyB0qjmNDwWDqPNk9GFwxPuQyKei6uXCHdVtWOhk8D2oKQFUt6ySD0sgYyLB7/4d04aoFHJ24Gbfrx5WsjyzwoTAweLkgq3+0ys0BzSrqK2RYvUEsDBBQAAAAIAG9+n1vuW4Vu3wAAAF8BAAARAAAAd29yZC9kb2N1bWVudC54bWx1kM9OxCAQxu99igl3S7dRs2la9qbxZvzzAFjGlgQGAlRcn15odm96+fIN8Jv5mPH0bQ18YYja0cQObccAaXZK0zKx97eHmyODmCQpaRzhxM4Y2Uk0Yx6UmzeLlKB0oDjkia0p+YHzOK9oZWydRyp3ny5YmUoZFp5dUD64GWMsA6zhfdfdcys1MdEAlK4fTp2r3QsvioQqSTxRiWEMPG5a4cjrUdWwq/8TedkIyFvQFzQ5iJhg8+3/fMQ5Pe+8X15/INd/Hfr+tuwlD2vxd8fi+U5d3tbg/Jq8uutmRPMLUEsBAhQDFAAAAAgAb36fW53FiiryAAAAuQEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACABvfp9bQKBTCbIAAAAvAQAACwAAAAAAAAAAAAAAgAEjAQAAX3JlbHMvLnJlbHNQSwECFAMUAAAACABvfp9b7luFbt8AAABfAQAAEQAAAAAAAAAAAAAAgAH+AQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAADAMAAAAA";

export function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kairo-doc-search-"));
}

export function cleanupTempDir(tempDir: string): void {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

export function setupWorkspace(tempDir: string): string {
  const rootDir = fs.mkdtempSync(path.join(tempDir, "run-"));
  PathManager.setRoot(rootDir);
  fs.mkdirSync(path.join(rootDir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "docs", "guide.md"), "# Guide\n\n## Install\nRun npm install to set up.\n\n## Usage\nUse npm start to begin.");
  fs.writeFileSync(path.join(rootDir, "docs", "faq.md"), "# FAQ\n\n## Troubleshooting\nIf install fails, clear cache.");
  return rootDir;
}

export function setupWorkspaceWithLog(tempDir: string): string {
  const rootDir = setupWorkspace(tempDir);
  fs.mkdirSync(path.join(rootDir, "logs"), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, "logs", "app.log"),
    [
      "2025-12-31T00:00:00Z INFO Booting service",
      "2025-12-31T00:00:02Z ERROR install failed: missing dependency",
      ""
    ].join("\n")
  );
  return rootDir;
}

export function setupWorkspaceWithMetrics(tempDir: string): string {
  const rootDir = setupWorkspace(tempDir);
  fs.mkdirSync(path.join(rootDir, "metrics"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "metrics", "latency.csv"), "latency 250\n");
  fs.writeFileSync(path.join(rootDir, "docs", "latency.md"), "latency 250\n");
  return rootDir;
}

export function setupWorkspaceWithCode(tempDir: string): string {
  const rootDir = setupWorkspace(tempDir);
  fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, "src", "widget.ts"),
    [
      "/**",
      " * Offline install is supported when the network is unavailable.",
      " * Use the cached model artifacts if possible.",
      " */",
      "export function installOffline() {",
      "  return true;",
      "}",
      ""
    ].join("\n")
  );
  return rootDir;
}

export function buildSamplePdfBuffer(text: string): Buffer {
  const escapePdfText = (value: string) =>
    value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  const content = `BT\n/F1 12 Tf\n72 720 Td\n(${escapePdfText(text)}) Tj\nET`;
  const objects = [
    "",
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];

  const parts: string[] = ["%PDF-1.4\n"];
  const offsets: number[] = [0];
  let offset = Buffer.byteLength(parts[0], "utf8");

  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = offset;
    const obj = `${i} 0 obj\n${objects[i]}\nendobj\n`;
    parts.push(obj);
    offset += Buffer.byteLength(obj, "utf8");
  }

  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`;
  const pdf = parts.join("") + xref + trailer;
  return Buffer.from(pdf, "utf8");
}

export async function buildSampleXlsxBuffer(): Promise<Buffer> {
  const xlsx = await import("xlsx");
  const workbook = xlsx.utils.book_new();
  const rows = [
    ["Error", "Message"],
    ["E001", "Install failed: missing dependency"],
    ["E002", "Install failed: network timeout"]
  ];
  const sheet = xlsx.utils.aoa_to_sheet(rows);
  xlsx.utils.book_append_sheet(workbook, sheet, "Errors");
  return xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
