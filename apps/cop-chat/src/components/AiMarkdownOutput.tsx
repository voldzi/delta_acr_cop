import React from "react";

export interface AiMarkdownMediaPreview {
  alt?: string;
  src: string;
  title?: string;
  type: "image" | "map";
}

interface AiMarkdownOutputProps {
  media?: AiMarkdownMediaPreview[];
  query?: string;
  text: string;
  variant?: "bubble" | "dialog";
}

type MarkdownBlock =
  | { level: number; text: string; type: "heading" }
  | { lines: string[]; type: "paragraph" }
  | { lines: string[]; type: "quote" }
  | { items: Array<{ depth: number; text: string }>; ordered: boolean; type: "list" }
  | { headers: string[]; rows: string[][]; type: "table" }
  | { language?: string; text: string; type: "code" };

export function AiMarkdownOutput({ media = [], query = "", text, variant = "bubble" }: AiMarkdownOutputProps) {
  const blocks = React.useMemo(() => parseMarkdownBlocks(text), [text]);
  const normalizedQuery = query.trim();
  return (
    <div className={`ai-output-markdown ${variant}`}>
      {blocks.map((block, index) => renderBlock(block, index, normalizedQuery))}
      {media.length ? (
        <div className="ai-output-media-grid">
          {media.map((item, index) => (
            <figure className="ai-output-media-card" key={`${item.src}-${index}`}>
              <img alt={item.alt ?? item.title ?? "AI náhled"} decoding="async" loading="lazy" src={item.src} />
              {item.title ? <figcaption>{item.title}</figcaption> : null}
            </figure>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, "\n").trim().split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ lines: paragraph, type: "paragraph" });
      paragraph = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const fence = line.match(/^```(?<language>[A-Za-z0-9_-]+)?\s*$/u);
    if (fence) {
      flushParagraph();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/u.test(lines[index] ?? "")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push({ language: fence.groups?.language, text: codeLines.join("\n"), type: "code" });
      continue;
    }

    const heading = line.match(/^(?<marks>#{1,6})\s+(?<text>.+)$/u);
    if (heading?.groups) {
      const marks = heading.groups.marks ?? "";
      const headingText = heading.groups.text ?? "";
      flushParagraph();
      blocks.push({
        level: marks.length,
        text: headingText.trim(),
        type: "heading"
      });
      continue;
    }

    if (isTableStart(lines, index)) {
      flushParagraph();
      const table = readTable(lines, index);
      blocks.push(table.block);
      index = table.nextIndex;
      continue;
    }

    const quote = line.match(/^>\s?(?<text>.*)$/u);
    if (quote?.groups) {
      flushParagraph();
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(/^>\s?(?<text>.*)$/u);
        if (!item?.groups) {
          break;
        }
        quoteLines.push((item.groups.text ?? "").trim());
        index += 1;
      }
      index -= 1;
      blocks.push({ lines: quoteLines, type: "quote" });
      continue;
    }

    const list = line.match(/^(?<indent>\s*)(?<marker>[-*+]|\d+[.)])\s+(?<text>.+)$/u);
    if (list?.groups) {
      flushParagraph();
      const ordered = /^\d/u.test(list.groups.marker ?? "");
      const items: Array<{ depth: number; text: string }> = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(/^(?<indent>\s*)(?<marker>[-*+]|\d+[.)])\s+(?<text>.+)$/u);
        const marker = item?.groups?.marker ?? "";
        if (!item?.groups || /^\d/u.test(marker) !== ordered) {
          break;
        }
        const indent = item.groups.indent ?? "";
        const itemText = item.groups.text ?? "";
        items.push({
          depth: Math.min(3, Math.floor(indent.replace(/\t/g, "  ").length / 2)),
          text: itemText.trim()
        });
        index += 1;
      }
      index -= 1;
      blocks.push({ items, ordered, type: "list" });
      continue;
    }

    paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks;
}

function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index]?.trim() ?? "";
  const separator = lines[index + 1]?.trim() ?? "";
  return parseTableCells(header).length >= 2 && isTableSeparator(separator);
}

function isTableSeparator(line: string): boolean {
  const cells = parseTableCells(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()));
}

function readTable(
  lines: string[],
  index: number
): { block: Extract<MarkdownBlock, { type: "table" }>; nextIndex: number } {
  const headers = parseTableCells(lines[index] ?? "");
  const rows: string[][] = [];
  let cursor = index + 2;
  while (cursor < lines.length) {
    const line = lines[cursor]?.trim() ?? "";
    if (!line || !line.includes("|")) {
      break;
    }
    const cells = parseTableCells(line);
    if (cells.length < 2) {
      break;
    }
    rows.push(headers.map((_, cellIndex) => cells[cellIndex] ?? ""));
    cursor += 1;
  }
  return {
    block: { headers, rows, type: "table" },
    nextIndex: cursor - 1
  };
}

function parseTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  if (!trimmed.includes("|")) {
    return [];
  }
  return trimmed.split("|").map((cell) => cell.trim());
}

function renderBlock(block: MarkdownBlock, index: number, query: string): React.ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = block.level <= 3 ? "h3" : "h4";
      return <Tag key={index}>{renderInline(block.text, query)}</Tag>;
    }
    case "paragraph":
      return <p key={index}>{renderInline(block.lines.join(" "), query)}</p>;
    case "quote":
      return (
        <blockquote key={index}>
          {block.lines.map((line, lineIndex) => (
            <p key={`${line}-${lineIndex}`}>{renderInline(line, query)}</p>
          ))}
        </blockquote>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className="ai-output-list" key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={`${item.text}-${itemIndex}`} style={{ marginLeft: `${item.depth * 14}px` }}>
              {renderInline(item.text, query)}
            </li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <div className="ai-output-table-wrap" key={index}>
          <table>
            <thead>
              <tr>
                {block.headers.map((header, headerIndex) => (
                  <th key={`${header}-${headerIndex}`}>{renderInline(header, query)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`${row.join("|")}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${cell}-${cellIndex}`}>{renderInline(cell, query)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return (
        <pre key={index}>
          <code>{block.text}</code>
        </pre>
      );
  }
}

function renderInline(text: string, query: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const tokenPattern = /(`[^`]+`|\*\*[^*]+?\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/giu;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(...renderPlainText(text.slice(cursor, match.index), query, nodes.length));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={`code-${nodes.length}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={`strong-${nodes.length}`}>{renderPlainText(token.slice(2, -2), query, 0)}</strong>);
    } else {
      const link = token.match(/^\[(?<label>[^\]]+)\]\((?<href>https?:\/\/[^)\s]+)\)$/iu);
      if (link?.groups) {
        const href = link.groups.href ?? "";
        const label = link.groups.label ?? href;
        nodes.push(
          <a href={href} key={`link-${nodes.length}`} rel="noreferrer noopener" target="_blank">
            {renderPlainText(label, query, 0)}
          </a>
        );
      } else {
        nodes.push(...renderPlainText(token, query, nodes.length));
      }
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) {
    nodes.push(...renderPlainText(text.slice(cursor), query, nodes.length));
  }
  return nodes;
}

function renderPlainText(text: string, query: string, keyOffset: number): React.ReactNode[] {
  if (!query) {
    return [text];
  }
  const parts = splitTextByQuery(text, query);
  return parts.map((part, index) =>
    part.match ? (
      <mark key={`mark-${keyOffset}-${index}`}>{part.text}</mark>
    ) : (
      <React.Fragment key={`text-${keyOffset}-${index}`}>{part.text}</React.Fragment>
    )
  );
}

function splitTextByQuery(text: string, query: string): Array<{ match: boolean; text: string }> {
  const normalizedQuery = query.trim().toLocaleLowerCase("cs-CZ");
  if (!normalizedQuery) {
    return [{ match: false, text }];
  }
  const normalizedText = text.toLocaleLowerCase("cs-CZ");
  const parts: Array<{ match: boolean; text: string }> = [];
  let cursor = 0;
  let index = normalizedText.indexOf(normalizedQuery);
  while (index >= 0) {
    if (index > cursor) {
      parts.push({ match: false, text: text.slice(cursor, index) });
    }
    parts.push({ match: true, text: text.slice(index, index + query.length) });
    cursor = index + query.length;
    index = normalizedText.indexOf(normalizedQuery, cursor);
  }
  if (cursor < text.length) {
    parts.push({ match: false, text: text.slice(cursor) });
  }
  return parts.length ? parts : [{ match: false, text }];
}
