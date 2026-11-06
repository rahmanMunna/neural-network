/** Sidebar data. Kept free of topic content, so it adds nothing to the bundle. */
export const BACKEND_BASE = "/software-development/backend";

export const BACKEND_NAV: { group: string; items: { slug: string; label: string }[] }[] = [
  { group: "Foundations", items: [{ slug: "client-server", label: "Client-Server" }] },
  {
    group: "Building blocks",
    items: [
      { slug: "redis", label: "Redis" },
      { slug: "rustfs", label: "RustFS" },
      { slug: "bullmq", label: "BullMQ" },
    ],
  },
  {
    group: "Architecture",
    items: [
      { slug: "n-tier", label: "N-Tier" },
      { slug: "monolith", label: "Monolith" },
      { slug: "modular-monolith", label: "Modular Monolith" },
      { slug: "microservices", label: "Microservices" },
      { slug: "saas", label: "SaaS" },
    ],
  },
  {
    group: "Traffic and security",
    items: [
      { slug: "rate-limiting", label: "Rate Limiting" },
      { slug: "authentication", label: "Authentication" },
      { slug: "authorization", label: "Authorization" },
    ],
  },
];
