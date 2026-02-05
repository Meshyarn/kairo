import { extractHtmlHeadings } from "./html/HtmlTextExtractor.js";
import { inferTextHeadings } from "./text/TextHeuristics.js";
import type { DocumentKind } from "../types.js";
import type { RemarkParseResult } from "./RemarkDocumentParser.js";
import type { HeadingNode } from "./DocumentProfilerTypes.js";
import { isFence, stripInlineJsx } from "./DocumentProfilerParsing.js";

export const extractHeadings = (lines: string[]): HeadingNode[] => {
  const headings: HeadingNode[] = [];
  let inCodeBlock = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isFence(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (!match) continue;
    const level = match[1].length;
    let title = match[2].replace(/\s+#*$/, "").trim();
    title = stripInlineJsx(title);
    if (!title) continue;
    headings.push({ title, level, line: index + 1 });
  }
  return headings;
};

export const applyMaxDepth = (headings: HeadingNode[], maxDepth?: number): HeadingNode[] => {
  if (!maxDepth || maxDepth <= 0) return headings;
  return headings.filter(heading => heading.level <= maxDepth);
};

export const resolveHeadings = (params: {
  kind: DocumentKind;
  lines: string[];
  content: string;
  remarkParsed: RemarkParseResult | null;
  treeMarkdownHeadings: HeadingNode[] | null;
  treeHtmlHeadings: Array<{ title: string; level: number; line: number }> | null;
}): HeadingNode[] => {
  if (params.kind === "markdown") {
    return params.treeMarkdownHeadings ?? params.remarkParsed?.headings ?? extractHeadings(params.lines);
  }
  if (params.kind === "mdx") {
    return params.remarkParsed?.headings ?? extractHeadings(params.lines);
  }
  if (params.kind === "html") {
    const html = params.content;
    return (params.treeHtmlHeadings ?? extractHtmlHeadings(html)).map(h => ({ title: h.title, level: h.level, line: h.line }));
  }
  if (params.kind === "css") {
    return [];
  }
  if (params.kind === "text") {
    return inferTextHeadings(params.content).map(h => ({ title: h.title, level: h.level, line: h.line }));
  }
  return [];
};
