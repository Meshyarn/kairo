import { extractHtmlReferences } from "./html/HtmlTextExtractor.js";
import type { DocumentKind } from "../types.js";
import type { RemarkParseResult } from "./RemarkDocumentParser.js";
import type { LinkNode } from "./DocumentProfilerTypes.js";
import { isFence, normalizeReference } from "./DocumentProfilerParsing.js";

export const extractLinks = (lines: string[]): LinkNode[] => {
  const links: LinkNode[] = [];
  let inCodeBlock = false;
  const definitions = new Map<string, string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isFence(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const defMatch = line.match(/^\s*\[([^\]]+)\]:\s*(\S+)(?:\s+\"[^\"]+\")?\s*$/);
    if (defMatch) {
      const key = normalizeReference(defMatch[1]);
      const href = defMatch[2].replace(/^<|>$/g, "");
      if (key && href) {
        definitions.set(key, href);
      }
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isFence(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const regex = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      const text = match[1];
      const href = match[2];
      links.push({ text, href, line: index + 1 });
    }

    const refRegex = /(?<!!)\[([^\]]+)\]\[([^\]]*)\]/g;
    while ((match = refRegex.exec(line)) !== null) {
      const text = match[1];
      const rawId = match[2] || match[1];
      const href = definitions.get(normalizeReference(rawId));
      if (!href) continue;
      links.push({ text, href, line: index + 1 });
    }
  }
  return links;
};

export const resolveLinks = (params: {
  kind: DocumentKind;
  lines: string[];
  content: string;
  remarkParsed: RemarkParseResult | null;
  treeMarkdownLinks?: LinkNode[] | null;
}): LinkNode[] => {
  if (params.kind === "markdown" || params.kind === "mdx") {
    const merged: LinkNode[] = [];
    const seen = new Set<string>();

    const pushUnique = (link: LinkNode) => {
      const key = `${link.href}::${link.text}::${link.line}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(link);
    };

    const remarkLinks = params.remarkParsed?.links ?? [];
    const regexLinks = extractLinks(params.lines);
    const treeLinks = params.treeMarkdownLinks ?? [];

    for (const link of remarkLinks) pushUnique(link);
    for (const link of regexLinks) pushUnique(link);
    for (const link of treeLinks) pushUnique(link);

    return merged;
  }
  if (params.kind === "html") {
    return extractHtmlReferences(params.content).map(item => ({ text: item.text, href: item.href, line: item.line }));
  }
  return [];
};
