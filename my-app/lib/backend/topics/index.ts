import type { Topic } from "../topic.ts";
import { microservices, modularMonolith, monolith, nTier, saas } from "./architecture.ts";
import { bullmq } from "./bullmq.ts";
import { clientServer } from "./client-server.ts";
import { redis } from "./redis.ts";
import { rustfs } from "./rustfs.ts";
import { authentication, authorization, rateLimiting } from "./security.ts";

export const TOPICS: Topic[] = [
  clientServer,
  redis,
  rustfs,
  bullmq,
  nTier,
  monolith,
  modularMonolith,
  microservices,
  saas,
  rateLimiting,
  authentication,
  authorization,
];

export const topicBySlug = (slug: string) => TOPICS.find((t) => t.slug === slug);
