"use client";

import { useState } from "react";
import { tokenize } from "@/lib/backend/highlight";

const COLOR = {
  comment: "var(--muted)",
  string: "var(--update)",
  keyword: "var(--neg)",
  number: "var(--grad)",
  fn: "var(--signal)",
  plain: "var(--text)",
} as const;

export function CodeBlock({
  code,
  lang,
  file,
  compact,
}: {
  code: string;
  lang: string;
  file?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <figure className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--stage)]">
      <figcaption className="flex h-9 items-center justify-between gap-3 border-b border-[var(--line)] px-3 text-[12px] text-[var(--muted)]">
        <span className="stage-num truncate">{file ?? lang}</span>
        <button type="button" onClick={copy} className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 hover:bg-[var(--raised)] hover:text-[var(--text)]">
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <pre className={`stage-num overflow-auto p-3.5 text-[12.5px] leading-[1.65] ${compact ? "max-h-64" : ""}`} tabIndex={0}>
        <code>
          {tokenize(code, lang).map((t, i) => (
            <span key={i} style={{ color: COLOR[t.kind] }}>
              {t.text}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}

/** Text with `inline code` marked by backticks. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 ? (
          <code key={i} className="stage-num rounded bg-[var(--raised)] px-1 py-px text-[0.88em] text-[var(--text)]">
            {part}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
