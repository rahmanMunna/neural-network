import katex from "katex";

function render(tex: string, display: boolean) {
  return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: false });
}

export function Tex({ children, display }: { children: string; display?: boolean }) {
  return <span dangerouslySetInnerHTML={{ __html: render(children, Boolean(display)) }} />;
}

/** Text with inline math between dollar signs. */
export function Prose({ text }: { text: string }) {
  const parts = text.split("$");
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <Tex key={i}>{part}</Tex> : <span key={i}>{part}</span>))}
    </>
  );
}
