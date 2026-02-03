import * as crypto from "crypto";
import * as path from "path";
import type { DocumentKind, DocumentSection } from "../types.js";
import type { HeadingNode } from "./DocumentProfilerTypes.js";

export const buildOutline = (params: {
  filePath: string;
  kind: DocumentKind;
  headings: HeadingNode[];
  lines: string[];
  lineOffsets: number[];
}): DocumentSection[] => {
  const { filePath, kind, headings, lines, lineOffsets } = params;
  if (headings.length === 0) {
    const title = path.basename(filePath);
    return [
      buildSection({
        filePath,
        kind,
        title,
        level: 1,
        path: [title],
        startLine: 1,
        endLine: lines.length,
        lineOffsets,
        lines,
        ordinal: 0
      })
    ];
  }

  const sections: DocumentSection[] = [];
  const stack: Array<{ title: string; level: number }> = [];
  const pathCounts = new Map<string, number>();

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    stack.push({ title: heading.title, level: heading.level });
    const pathTitles = stack.map(item => item.title);
    const pathKey = pathTitles.join(" > ");
    const ordinal = (pathCounts.get(pathKey) ?? 0) + 1;
    pathCounts.set(pathKey, ordinal);

    const nextHeading = headings[index + 1];
    const endLine = nextHeading ? nextHeading.line - 1 : lines.length;
    sections.push(
      buildSection({
        filePath,
        kind,
        title: heading.title,
        level: heading.level,
        path: [...pathTitles],
        startLine: heading.line,
        endLine: Math.max(heading.line, endLine),
        lineOffsets,
        lines,
        ordinal
      })
    );
  }

  return sections;
};

export const resolveTitle = (frontmatter: Record<string, unknown> | undefined, outline: DocumentSection[], filePath: string): string => {
  const fmTitle = frontmatter?.title;
  if (typeof fmTitle === "string" && fmTitle.trim()) {
    return fmTitle.trim();
  }
  const h1 = outline.find(section => section.level === 1);
  if (h1?.title) return h1.title;
  return path.basename(filePath);
};

const buildSection = (params: {
  filePath: string;
  kind: DocumentKind;
  title: string;
  level: number;
  path: string[];
  startLine: number;
  endLine: number;
  lines: string[];
  lineOffsets: number[];
  ordinal: number;
}): DocumentSection => {
  const { filePath, kind, title, level, path, startLine, endLine, lines, lineOffsets, ordinal } = params;
  const text = lines.slice(startLine - 1, endLine).join("\n");
  const contentHash = hash(text);

  const sectionLines = lines.slice(startLine, endLine);
  const nonEmptyLines = sectionLines.filter(l => l.trim().length > 0);
  let summary: string | undefined;

  if (nonEmptyLines.length > 0) {
    summary = `(${nonEmptyLines.length} lines of content)`;
  }

  return {
    id: hash(`${filePath}\n${path.join(" > ")}\n${ordinal}`),
    filePath,
    kind,
    title,
    level,
    path,
    range: {
      startLine,
      endLine,
      startByte: lineOffsets[startLine - 1] ?? 0,
      endByte: computeEndByte(endLine, lines, lineOffsets)
    },
    contentHash,
    summary
  };
};

const computeEndByte = (endLine: number, lines: string[], offsets: number[]): number => {
  const index = Math.max(0, Math.min(endLine - 1, lines.length - 1));
  const lineOffset = offsets[index] ?? 0;
  return lineOffset + lines[index].length;
};

const hash = (text: string): string => {
  return crypto.createHash("sha256").update(text).digest("hex");
};
