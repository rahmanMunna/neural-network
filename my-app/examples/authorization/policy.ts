// #region rbac
export type Role = "viewer" | "editor" | "admin";
export type Permission = "doc:read" | "doc:write" | "doc:delete" | "user:manage";

/** Role-based access: permissions attach to roles, and users receive roles. */
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  viewer: ["doc:read"],
  editor: ["doc:read", "doc:write"],
  admin: ["doc:read", "doc:write", "doc:delete", "user:manage"],
};

export const hasPermission = (role: Role, permission: Permission) =>
  ROLE_PERMISSIONS[role].includes(permission);
// #endregion

// #region abac
export interface Actor {
  id: string;
  role: Role;
  tenant: string;
}

export interface Doc {
  id: string;
  tenant: string;
  ownerId: string;
  status: "draft" | "published";
}

/**
 * Attribute-based rules look at this actor and this record. Roles alone cannot
 * say "editors may change only their own drafts". Deny comes first, and the
 * tenant check comes before everything else.
 */
export function can(actor: Actor, action: "read" | "write" | "delete", doc: Doc): boolean {
  if (actor.tenant !== doc.tenant) return false;

  switch (action) {
    case "read":
      if (!hasPermission(actor.role, "doc:read")) return false;
      return doc.status === "published" || doc.ownerId === actor.id || actor.role === "admin";
    case "write":
      if (!hasPermission(actor.role, "doc:write")) return false;
      return actor.role === "admin" || (doc.ownerId === actor.id && doc.status === "draft");
    case "delete":
      return hasPermission(actor.role, "doc:delete");
  }
}
// #endregion
