import type { DocumentKind } from "../types.js";
import type { RemarkParseResult } from "./RemarkDocumentParser.js";
import { extractHtmlHeadings } from "./html/HtmlTextExtractor.js";
import type { HeadingNode } from "./DocumentProfilerTypes.js";

export const resolveParserInfo = (params: {
  kind: DocumentKind;
  content: string;
  treeMarkdownHeadings: HeadingNode[] | null;
  treeHtmlHeadings: HeadingNode[] | null;
  remarkParsed: RemarkParseResult | null;
}): { name: "tree-sitter" | "remark" | "regex"; degraded: boolean; reason?: string } | undefined => {
  const { kind, treeMarkdownHeadings, treeHtmlHeadings, remarkParsed } = params;
  if (kind === "markdown") {
    if (treeMarkdownHeadings !== null) {
      return { name: "tree-sitter", degraded: false };
    }
    if (remarkParsed?.headings?.length) {
      return { name: "remark", degraded: true, reason: "parser_fallback" };
    }
    return { name: "regex", degraded: true, reason: "parser_fallback" };
  }
  if (kind === "mdx") {
    if (remarkParsed?.headings?.length) {
      return { name: "remark", degraded: false };
    }
    return { name: "regex", degraded: true, reason: "parser_fallback" };
  }
  if (kind === "html") {
    if (treeHtmlHeadings !== null) {
      return { name: "tree-sitter", degraded: false };
    }
    const fallback = extractHtmlHeadings(params.content);
    if (fallback.length > 0) {
      return { name: "regex", degraded: true, reason: "parser_fallback" };
    }
    return { name: "regex", degraded: false };
  }
  if (kind === "css" || kind === "text") {
    return { name: "regex", degraded: false };
  }
  return { name: "regex", degraded: false };
};
