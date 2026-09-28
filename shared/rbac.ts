// Roles and permissions. One matrix, read it and you know who can do what.

export const ROLES = ["owner", "admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "company.read",
  "company.update",
  "company.delete",
  "members.read",
  "members.manage",
  "knowledge.read",
  "knowledge.write",
  "knowledge.activate",
  "conversations.read",
  "conversations.takeover",
  "connection.manage",
  "agent.settings",
  "agent.mode",
  "sidebar.tokens",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  admin: new Set<Permission>([
    "company.read",
    "company.update",
    "members.read",
    "members.manage",
    "knowledge.read",
    "knowledge.write",
    "knowledge.activate",
    "conversations.read",
    "conversations.takeover",
    "connection.manage",
    "agent.settings",
    "agent.mode",
    "sidebar.tokens",
  ]),
  member: new Set<Permission>([
    "company.read",
    "members.read",
    "knowledge.read",
    "knowledge.write",
    "conversations.read",
    "conversations.takeover",
  ]),
  viewer: new Set<Permission>(["company.read", "members.read", "knowledge.read", "conversations.read"]),
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return role ? MATRIX[role].has(permission) : false;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Which roles an actor may hand out. Only an owner can create another owner (that is a transfer). */
export function assignableRoles(actor: Role): Role[] {
  if (actor === "owner") return ["owner", "admin", "member", "viewer"];
  if (actor === "admin") return ["admin", "member", "viewer"];
  return [];
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Full control, including deleting the company and transferring ownership.",
  admin: "Manage members, Freshchat connection, knowledge, and agent settings.",
  member: "Edit knowledge, watch conversations, and take over chats.",
  viewer: "Read-only access to knowledge and conversations.",
};
