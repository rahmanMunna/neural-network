import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TopicPage } from "@/components/backend/TopicPage";
import { TOPICS, topicBySlug } from "@/lib/backend/topics";

export function generateStaticParams() {
  return TOPICS.map((t) => ({ topic: t.slug }));
}

export async function generateMetadata({ params }: PageProps<"/software-development/backend/[topic]">): Promise<Metadata> {
  const topic = topicBySlug((await params).topic);
  return topic ? { title: topic.title, description: topic.lede } : {};
}

async function Topic({ params }: { params: PageProps<"/software-development/backend/[topic]">["params"] }) {
  const topic = topicBySlug((await params).topic);
  if (!topic) notFound();
  return <TopicPage topic={topic} />;
}

export default function Page({ params }: PageProps<"/software-development/backend/[topic]">) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh w-full max-w-[1500px] px-6 pt-8 text-[var(--muted)]">Loading…</main>}>
      <Topic params={params} />
    </Suspense>
  );
}
