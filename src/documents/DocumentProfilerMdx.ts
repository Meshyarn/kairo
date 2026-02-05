import { stripInlineJsx } from "./DocumentProfilerParsing.js";

export const applyMdxPlaceholders = (content: string): string => {
  let output = content;
  output = output.replace(/\{([A-Za-z0-9_$]+)\}/g, (_, name) => `[[mdx:${name}]]`);
  output = output.replace(/\{[^}]+\}/g, "[[mdx:expr]]");
  output = output.replace(/<([A-Za-z0-9_]+)([^>]*)\/>/g, (_, name, attrs) => {
    const summarized = summarizeMdxProps(String(attrs));
    return `[[mdx:${name}${summarized ? " " + summarized : ""}]]`;
  });
  output = output.replace(/<([A-Za-z0-9_]+)([^>]*)>([\s\S]*?)<\/\1>/g, (_, name, attrs, children) => {
    const summarized = summarizeMdxProps(String(attrs));
    const childText = stripInlineJsx(String(children)).trim();
    if (childText) {
      return `${childText}`;
    }
    return `[[mdx:${name}${summarized ? " " + summarized : ""}]]`;
  });
  return output;
};

const summarizeMdxProps = (raw: string): string => {
  const props: string[] = [];
  const attrRegex = /([A-Za-z0-9_]+)\s*=\s*("([^"]*)"|'([^']*)'|\{([^}]+)\}|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(raw)) !== null) {
    const name = match[1];
    const rawValue = match[3] ?? match[4] ?? match[5] ?? match[6];
    if (rawValue == null) continue;
    const normalized = normalizePropValue(rawValue);
    if (normalized == null) continue;
    props.push(`${name}="${normalized}"`);
  }
  return props.join(" ");
};

const normalizePropValue = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === "true" || trimmed === "false") return trimmed;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (/^[A-Za-z0-9_\-./ ]+$/.test(trimmed)) return trimmed;
  return null;
};
