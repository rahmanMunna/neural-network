"use client";

import type { LabKind } from "@/lib/backend/topic";
import { AuthzLab, ErasureLab, RateLimitLab } from "./Labs";

export function LabSlot({ kind }: { kind: LabKind }) {
  if (kind === "rate-limit") return <RateLimitLab />;
  if (kind === "erasure") return <ErasureLab />;
  return <AuthzLab />;
}
