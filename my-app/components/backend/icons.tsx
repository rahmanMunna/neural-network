import type { IconKind } from "@/lib/backend/flow";

/** Line icons on a 20 unit grid, drawn with the current colour. */
const PATHS: Record<IconKind, string> = {
  client: "M3 4h14v9H3zM7 16h6M10 13v3",
  dns: "M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM2.5 10h15M10 2.5c-5 5-5 10 0 15M10 2.5c5 5 5 10 0 15",
  cdn: "M6 15a3.5 3.5 0 0 1-.4-7A5 5 0 0 1 15 7.5a3.8 3.8 0 0 1-.5 7.5zM10 15v3M6 18h8",
  proxy: "M3 10h5M12 10h5M8 6h4v8H8zM14.5 7.5 17 10l-2.5 2.5",
  lb: "M3 10h5M8 10l5-5h4M8 10l5 5h4M8 10h9",
  api: "M3 4h14v5H3zM3 11h14v5H3zM6 6.5h.01M6 13.5h.01",
  redis: "M11.5 2 4.5 11H10l-1.5 7 7-9H10z",
  db: "M3.5 5c0-1.4 2.9-2.5 6.5-2.5s6.5 1.100 6.500 2.500-2.900 2.500-6.500 2.500S3.500 6.400 3.500 5zM3.500 5v10c0 1.400 2.900 2.500 6.500 2.500s6.500-1.100 6.500-2.500V5M3.500 10c0 1.400 2.900 2.500 6.500 2.500s6.500-1.100 6.500-2.500",
  queue: "M2.500 6h4v8h-4zM8 6h4v8H8zM13.500 6h4v8h-4z",
  worker: "M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM10 2v2.500M10 15.500V18M2 10h2.500M15.500 10H18M4.300 4.300l1.800 1.800M13.900 13.900l1.800 1.800M4.300 15.700l1.800-1.800M13.900 6.100l1.800-1.800",
  storage: "M3 6l7-3.500L17 6v8l-7 3.500L3 14zM3 6l7 3.500L17 6M10 9.500v8",
  limiter: "M10 2.500a7.500 7.500 0 1 0 0 15 7.500 7.500 0 0 0 0-15zM10 10l3.500-3.500M5.500 13h9",
  auth: "M10 2.500 4 5v5c0 3.700 2.500 6.300 6 7.500 3.500-1.200 6-3.800 6-7.500V5zM7.500 10l2 2 3.500-3.500",
  service: "M10 2.500 16.500 6.300v7.400L10 17.500 3.500 13.700V6.300z",
  module: "M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z",
  tenant: "M4 17V5l6-2.500V17M10 8h6v9M2.500 17h15M6.500 8h1M6.500 11h1M6.500 14h1M12.500 11h1M12.500 14h1",
  attacker: "M10 3a6 6 0 0 0-4 10.500V16h8v-2.500A6 6 0 0 0 10 3zM7.500 9.500h.01M12.500 9.500h.01M8 16v1.500M12 16v1.500",
};

export function iconPath(kind: IconKind) {
  return PATHS[kind];
}

export function Icon({ kind, size = 20 }: { kind: IconKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[kind]} />
    </svg>
  );
}
