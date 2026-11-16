import { Fragment, type ReactNode } from "react";

/**
 * Lesson text with simple formatting, written like Markdown:
 *
 *   # Heading / ## Subheading / ### Small heading
 *   - item or * item        (bulleted list)
 *   1. item                 (numbered list)
 *   > tip                   (highlighted note)
 *   **bold**, *italic*, [link text](https://example.com) and bare https:// links
 *
 * Blank lines separate paragraphs; a single line break stays a line break. Everything is rendered as React elements
 * (never raw HTML), and only http(s) links are made clickable, so lesson text can't inject markup or scripts.
 */
export default function LessonText({ text, className = "" }: { text: string; className?: string }) {
  return <div className={`space-y-4 text-base leading-relaxed text-slate-800 ${className}`}>{blocks(text)}</div>;
}

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "paragraph"; lines: string[] };

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;

function parse(text: string): Block[] {
  const result: Block[] = [];
  let current: Block | null = null;
  const flush = () => {
    if (current) result.push(current);
    current = null;
  };

  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      result.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const item = (numbered ? numbered[2] : bullet![1]).trim();
      const list = current as Block | null;
      if (list?.kind === "list" && list.ordered === ordered) {
        list.items.push(item);
      } else {
        flush();
        current = { kind: "list", ordered, start: numbered ? Number(numbered[1]) : 1, items: [item] };
      }
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      const block = current as Block | null;
      if (block?.kind === "quote") block.lines.push(quote[1]);
      else {
        flush();
        current = { kind: "quote", lines: [quote[1]] };
      }
      continue;
    }
    const block = current as Block | null;
    if (block?.kind === "paragraph") block.lines.push(line.trim());
    else {
      flush();
      current = { kind: "paragraph", lines: [line.trim()] };
    }
  }
  flush();
  return result;
}

function blocks(text: string): ReactNode[] {
  return parse(text).map((block, index) => {
    switch (block.kind) {
      case "heading": {
        const styles = { 1: "text-xl font-bold text-slate-900", 2: "text-lg font-bold text-slate-900", 3: "font-semibold text-slate-900" };
        const Tag = (["h3", "h4", "h5"] as const)[block.level - 1];
        return <Tag key={index} className={`${styles[block.level]} pt-2`}>{inline(block.text)}</Tag>;
      }
      case "list": {
        const items = block.items.map((item, i) => <li key={i}>{inline(item)}</li>);
        return block.ordered ? (
          <ol key={index} start={block.start} className="list-decimal space-y-1.5 pl-6 marker:font-semibold marker:text-slate-500">{items}</ol>
        ) : (
          <ul key={index} className="list-disc space-y-1.5 pl-6 marker:text-amber-500">{items}</ul>
        );
      }
      case "quote":
        return (
          <aside key={index} className="rounded-xl border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-slate-800">
            {withBreaks(block.lines)}
          </aside>
        );
      default:
        return <p key={index}>{withBreaks(block.lines)}</p>;
    }
  });
}

function withBreaks(lines: string[]): ReactNode[] {
  return lines.map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {inline(line)}
    </Fragment>
  ));
}

// **bold**, *italic*, [text](https://…) and bare https:// links, in one pass.
const INLINE = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g;

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const key = `${at}-${parts.length}`;
    if (match[1] !== undefined) parts.push(<strong key={key} className="font-semibold text-slate-900">{match[1]}</strong>);
    else if (match[2] !== undefined) parts.push(<em key={key}>{match[2]}</em>);
    else {
      const href = match[4] ?? match[5];
      parts.push(
        <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-[var(--navy)] underline break-words">
          {match[3] ?? href}
        </a>,
      );
    }
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
