/**
 * The policy from examples/authorization, with each check reported so a learner
 * can see exactly why a request was allowed or refused.
 */

export type Role = "viewer" | "editor" | "admin";
export type Action = "read" | "write" | "delete";

export interface Scenario {
  authenticated: boolean;
  role: Role;
  sameTenant: boolean;
  isOwner: boolean;
  status: "draft" | "published";
  action: Action;
}

export interface Check {
  label: string;
  passed: boolean;
}

export interface Verdict {
  status: 200 | 401 | 403 | 404;
  reason: string;
  checks: Check[];
}

const PERMISSIONS: Record<Role, Action[]> = {
  viewer: ["read"],
  editor: ["read", "write"],
  admin: ["read", "write", "delete"],
};

export function evaluate(s: Scenario): Verdict {
  const checks: Check[] = [{ label: "Valid token (who are you?)", passed: s.authenticated }];
  if (!s.authenticated) return { status: 401, reason: "No valid identity, so no decision can be made.", checks };

  checks.push({ label: "Record belongs to your tenant", passed: s.sameTenant });
  if (!s.sameTenant) {
    return { status: 404, reason: "A 403 would confirm the record exists, so another tenant gets 404.", checks };
  }

  const granted = PERMISSIONS[s.role].includes(s.action);
  checks.push({ label: `Role "${s.role}" allows ${s.action}`, passed: granted });
  if (!granted) return { status: 403, reason: "Your identity is known, but your role does not allow this.", checks };

  if (s.action === "read") {
    const visible = s.status === "published" || s.isOwner || s.role === "admin";
    checks.push({ label: "Published, or yours, or you are an admin", passed: visible });
    if (!visible) return { status: 403, reason: "Drafts are private to their owner and to admins.", checks };
  }
  if (s.action === "write") {
    const editable = s.role === "admin" || (s.isOwner && s.status === "draft");
    checks.push({ label: "Your own draft, or you are an admin", passed: editable });
    if (!editable) return { status: 403, reason: "Editors may only change their own drafts.", checks };
  }
  return { status: 200, reason: "Every check passed.", checks };
}
