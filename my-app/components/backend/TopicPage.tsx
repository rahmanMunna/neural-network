import Link from "next/link";
import { BACKEND_BASE } from "@/lib/backend/nav";
import { SNIPPETS } from "@/lib/backend/snippets.generated";
import type { SnippetId } from "@/lib/backend/snippets.generated";
import type { Block, Topic } from "@/lib/backend/topic";
import { TOPICS } from "@/lib/backend/topics";
import { CodeBlock, Rich } from "./Code";
import { FlowPlayer } from "./FlowPlayer";
import type { SnippetView } from "./FlowPlayer";
import { LabSlot } from "./LabSlot";
import { SystemDesigner } from "./SystemDesigner";

function BlockView({ block }: { block: Block }) {
  if ("p" in block) {
    return (
      <p className="max-w-[68ch] text-[16.5px] leading-[1.7] text-[var(--text-soft)]">
        <Rich text={block.p} />
      </p>
    );
  }
  if ("list" in block) {
    return (
      <ul className="max-w-[68ch] list-disc space-y-1.5 pl-5 text-[16px] leading-relaxed text-[var(--text-soft)] marker:text-[var(--line-strong)]">
        {block.list.map((item) => (
          <li key={item}>
            <Rich text={item} />
          </li>
        ))}
      </ul>
    );
  }
  if ("steps" in block) {
    return (
      <ol className="max-w-[68ch] list-decimal space-y-1.5 pl-5 text-[16px] leading-relaxed text-[var(--text-soft)] marker:text-[var(--muted)]">
        {block.steps.map((item) => (
          <li key={item}>
            <Rich text={item} />
          </li>
        ))}
      </ol>
    );
  }
  if ("table" in block) {
    return (
      <div className="max-w-[860px] overflow-x-auto rounded-xl border border-[var(--line)]">
        <table className="w-full border-collapse text-left text-[14.5px]">
          <thead>
            <tr className="bg-[var(--panel)]">
              {block.table.head.map((h) => (
                <th key={h} scope="col" className="px-3.5 py-2.5 font-medium whitespace-nowrap text-[var(--text)]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.table.rows.map((row) => (
              <tr key={row.join("|")} className="border-t border-[var(--line)]">
                {row.map((cell, i) => (
                  <td key={i} className={`px-3.5 py-2.5 align-top ${i === 0 ? "font-medium text-[var(--text)]" : "text-[var(--text-soft)]"}`}>
                    <Rich text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <aside className="max-w-[68ch] border-l-2 border-[var(--grad)] pl-4 text-[15.5px] leading-relaxed text-[var(--text-soft)]">
      {block.title && <div className="mb-0.5 font-medium text-[var(--text)]">{block.title}</div>}
      <Rich text={block.callout} />
    </aside>
  );
}

function SectionTitle({ eyebrow, title, intro }: { eyebrow: string; title: string; intro?: string }) {
  return (
    <header className="mb-5">
      <div className="text-[13px] font-medium text-[var(--signal)]">{eyebrow}</div>
      <h2 className="font-display mt-0.5 text-[36px] leading-tight text-[var(--text)]">{title}</h2>
      {intro && (
        <p className="mt-2 max-w-[68ch] text-[16.5px] leading-relaxed text-[var(--text-soft)]">
          <Rich text={intro} />
        </p>
      )}
    </header>
  );
}

function Snippet({ id }: { id: SnippetId }) {
  const s = SNIPPETS[id];
  return <CodeBlock code={s.code} lang={s.lang} file={s.file} />;
}

const SECTIONS = [
  ["learn", "Learn"],
  ["see", "See it work"],
  ["build", "Build it"],
  ["simulate", "Simulate"],
] as const;

export function TopicPage({ topic }: { topic: Topic }) {
  const snippets: Record<string, SnippetView> = {};
  for (const scenario of topic.flow.scenarios) {
    for (const step of scenario.steps) {
      if (step.code) {
        const s = SNIPPETS[step.code];
        snippets[step.code] = { code: s.code, lang: s.lang, file: s.file };
      }
    }
  }

  const at = TOPICS.findIndex((t) => t.slug === topic.slug);
  const prev = TOPICS[at - 1];
  const next = TOPICS[at + 1];

  return (
    <main className="mx-auto w-full max-w-[1500px] px-4 pb-20 sm:px-6">
      <header className="pt-8 pb-5">
        <p className="text-[13.5px] text-[var(--muted)]">Backend Technologies / {topic.group}</p>
        <h1 className="font-display mt-1 text-[44px] leading-[1.08] sm:text-[54px]">{topic.title}</h1>
        <p className="mt-3 max-w-[66ch] text-[18px] leading-relaxed text-[var(--text-soft)]">{topic.lede}</p>
      </header>

      <nav aria-label="On this page" className="sticky top-12 z-20 -mx-4 mb-8 flex gap-1 overflow-x-auto border-y border-[var(--line)] bg-[var(--bg)] px-4 py-1.5 sm:-mx-6 sm:px-6 lg:top-0">
        {SECTIONS.map(([id, label], i) => (
          <a key={id} href={`#${id}`} className="rounded-lg px-3 py-1.5 text-[14px] whitespace-nowrap text-[var(--text-soft)] hover:bg-[var(--raised)] hover:text-[var(--text)]">
            <span className="stage-num mr-1.5 text-[var(--muted)]">{i + 1}</span>
            {label}
          </a>
        ))}
      </nav>

      <section id="learn" className="scroll-mt-16">
        <SectionTitle eyebrow="Step 1" title="Learn the idea" />
        <div className="space-y-9">
          {topic.learn.map((section) => (
            <div key={section.heading} className="space-y-3.5">
              <h3 className="font-display text-[27px] leading-tight text-[var(--text)]">{section.heading}</h3>
              {section.blocks.map((block, i) => (
                <BlockView key={i} block={block} />
              ))}
            </div>
          ))}
        </div>
      </section>

      <section id="see" className="mt-16 scroll-mt-16">
        <SectionTitle eyebrow="Step 2" title="See it work" intro="Press Next to move one step at a time, or Auto to let it play. The arrow keys work too." />
        <FlowPlayer spec={topic.flow} snippets={snippets} />
      </section>

      <section id="build" className="mt-16 scroll-mt-16">
        <SectionTitle eyebrow="Step 3" title="Build it in your project" intro={topic.build.intro} />

        <div className="grid max-w-[960px] gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-1.5 text-[15px] font-medium text-[var(--text)]">You will need</h3>
            <ul className="list-disc space-y-1 pl-5 text-[15px] text-[var(--text-soft)] marker:text-[var(--line-strong)]">
              {topic.build.needs.map((n) => (
                <li key={n}>
                  <Rich text={n} />
                </li>
              ))}
            </ul>
          </div>
          {topic.build.tree && (
            <div>
              <h3 className="mb-1.5 text-[15px] font-medium text-[var(--text)]">Where the files go</h3>
              <pre className="stage-num overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--stage)] p-3 text-[12.5px] leading-relaxed text-[var(--text-soft)]">
                {topic.build.tree}
              </pre>
            </div>
          )}
        </div>

        {topic.build.install && (
          <div className="mt-5 max-w-[960px]">
            <h3 className="mb-1.5 text-[15px] font-medium text-[var(--text)]">Install</h3>
            <CodeBlock code={topic.build.install} lang="bash" file="terminal" />
          </div>
        )}

        <ol className="mt-9 max-w-[960px] space-y-10">
          {topic.build.steps.map((step, i) => (
            <li key={step.title}>
              <h3 className="font-display flex items-baseline gap-3 text-[25px] leading-tight text-[var(--text)]">
                <span className="stage-num text-[15px] text-[var(--signal)]">{i + 1}</span>
                {step.title}
              </h3>
              <div className="mt-2.5 space-y-2.5">
                {step.explain.map((line) => (
                  <p key={line} className="text-[16px] leading-[1.7] text-[var(--text-soft)]">
                    <Rich text={line} />
                  </p>
                ))}
              </div>
              <div className="mt-3.5 space-y-3">
                {[step.code ?? []].flat().map((id) => (
                  <Snippet key={id} id={id} />
                ))}
                {step.shell && <CodeBlock code={step.shell} lang={step.shellLang ?? "bash"} file={step.shellLang ? "browser code" : "terminal"} />}
              </div>
              {step.where && (
                <p className="mt-3 border-l-2 border-[var(--signal)] pl-3 text-[14.5px] leading-relaxed text-[var(--text-soft)]">
                  <span className="font-medium text-[var(--text)]">In your project: </span>
                  <Rich text={step.where} />
                </p>
              )}
            </li>
          ))}
        </ol>

        <div className="mt-12 grid max-w-[960px] gap-8 md:grid-cols-2">
          <div>
            <h3 className="font-display text-[25px] text-[var(--text)]">Adding this to an existing project</h3>
            <ol className="mt-2.5 list-decimal space-y-2 pl-5 text-[15.5px] leading-relaxed text-[var(--text-soft)] marker:text-[var(--muted)]">
              {topic.build.integrate.map((line) => (
                <li key={line}>
                  <Rich text={line} />
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="font-display text-[25px] text-[var(--text)]">Common mistakes</h3>
            <dl className="mt-2.5 space-y-3">
              {topic.build.mistakes.map((m) => (
                <div key={m.title}>
                  <dt className="text-[15.5px] font-medium text-[var(--text)]">
                    <Rich text={m.title} />
                  </dt>
                  <dd className="text-[15px] leading-relaxed text-[var(--text-soft)]">
                    <Rich text={m.text} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <p className="mt-8 max-w-[960px] text-[14px] text-[var(--muted)]">
          The code on this page is copied at build time from the <code className="stage-num">examples/</code> folder in this
          site&apos;s repository, where it is tested against real services.
        </p>
      </section>

      <section id="simulate" className="mt-16 scroll-mt-16">
        <SectionTitle eyebrow="Step 4" title="Simulate it yourself" intro={topic.simulate.intro} />
        {topic.simulate.lab && (
          <div className="mb-8">
            {topic.simulate.labIntro && <p className="mb-3 max-w-[68ch] text-[15.5px] leading-relaxed text-[var(--text-soft)]">{topic.simulate.labIntro}</p>}
            <LabSlot kind={topic.simulate.lab} />
          </div>
        )}
        <SystemDesigner preset={topic.simulate.preset} embedded />
        <div className="mt-5 max-w-[68ch]">
          <h3 className="mb-1.5 text-[15.5px] font-medium text-[var(--text)]">Try this</h3>
          <ol className="list-decimal space-y-1.5 pl-5 text-[15.5px] leading-relaxed text-[var(--text-soft)] marker:text-[var(--muted)]">
            {topic.simulate.tries.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </div>
      </section>

      {topic.sources && (
        <section className="mt-14 max-w-[68ch] border-t border-[var(--line)] pt-5">
          <h2 className="text-[15px] font-medium text-[var(--text)]">Further reading</h2>
          <ul className="mt-1.5 space-y-1 text-[14.5px]">
            {topic.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer" className="text-[var(--signal)] underline underline-offset-3">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav aria-label="Next topic" className="mt-12 flex flex-wrap justify-between gap-3">
        {prev ? (
          <Link href={`${BACKEND_BASE}/${prev.slug}`} className="btn">
            Previous: {prev.nav}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={`${BACKEND_BASE}/${next.slug}`} className="btn btn-primary">
            Next: {next.nav}
          </Link>
        )}
      </nav>
    </main>
  );
}
