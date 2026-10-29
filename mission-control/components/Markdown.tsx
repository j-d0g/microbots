// Tiny, safe markdown: headings, bullets, bold, inline code, paragraphs. No HTML passthrough.
import { Fragment, type ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith("**") ? <strong key={i++}>{tok.slice(2, -2)}</strong> : <code key={i++}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={blocks.length}>
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) {
      list.push(li[1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const Tag = (level === 1 ? "h1" : level === 2 ? "h2" : "h3") as "h1";
      blocks.push(<Tag key={blocks.length}>{inline(h[2])}</Tag>);
    } else blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className={`md text-[13px] leading-relaxed text-ink-2 ${className}`}>{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
