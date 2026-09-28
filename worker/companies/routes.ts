import { assignableRoles, isRole, type Role } from "../../shared/rbac";
import { router } from "../app";
import { requireUser } from "../auth/middleware";
import { all, one, run } from "../db";
import { logEvent } from "../events";
import { randomToken, sha256Hex } from "../lib/crypto";
import { publicBaseUrl, sendEmail } from "../lib/email";
import { badRequest, conflict, forbidden, isEmail, notFound, readJson, str } from "../lib/http";
import { newId } from "../lib/ids";
import { withCompany } from "./middleware";
import {
  countOwners,
  createCompany,
  deleteCompany,
  getCompanyDetail,
  listCompaniesForUser,
  listInvites,
  listMembers,
} from "./repo";

export const companyRoutes = router();
companyRoutes.use("*", requireUser);

companyRoutes.get("/", async (c) => c.json({ companies: await listCompaniesForUser(c.env.DB, c.get("user").id) }));

companyRoutes.post("/", async (c) => {
  const body = await readJson<{ name?: unknown }>(c);
  const name = str(body.name, 80);
  if (name.length < 2) throw badRequest("Give the company a name.");
  const company = await createCompany(c.env.DB, name, c.get("user").id);
  await logEvent(c.env.DB, company.id, "company_created", { by: c.get("user").email });
  return c.json({ company: { id: company.id, slug: company.slug, name: company.name, role: "owner", mode: "off", createdAt: company.created_at } }, 201);
});

companyRoutes.get("/:slug", withCompany("company.read"), async (c) =>
  c.json({ company: await getCompanyDetail(c.env.DB, c.get("company"), c.get("role")) }),
);

companyRoutes.patch("/:slug", withCompany("company.update"), async (c) => {
  const body = await readJson<{ name?: unknown }>(c);
  const name = str(body.name, 80);
  if (name.length < 2) throw badRequest("Give the company a name.");
  await run(c.env.DB, "UPDATE companies SET name = ? WHERE id = ?", name, c.get("company").id);
  return c.json({ ok: true });
});

companyRoutes.delete("/:slug", withCompany("company.delete"), async (c) => {
  await deleteCompany(c.env.DB, c.get("company").id);
  return c.json({ ok: true });
});

// ---- Members and invites ------------------------------------------------------------------

companyRoutes.get("/:slug/members", withCompany("members.read"), async (c) => {
  const [members, invites] = await Promise.all([listMembers(c.env.DB, c.get("company").id), listInvites(c.env.DB, c.get("company").id)]);
  return c.json({ members, invites, assignableRoles: assignableRoles(c.get("role")) });
});

companyRoutes.post("/:slug/invites", withCompany("members.manage"), async (c) => {
  const body = await readJson<{ email?: unknown; role?: unknown }>(c);
  const email = str(body.email, 254).toLowerCase();
  const role = body.role;
  if (!isEmail(email)) throw badRequest("Enter a valid email address.");
  if (!isRole(role) || role === "owner" || !assignableRoles(c.get("role")).includes(role)) throw badRequest("Pick a role you are allowed to assign.");
  const company = c.get("company");
  const existing = await one<{ user_id: string }>(
    c.env.DB,
    "SELECT m.user_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ? AND u.email = ?",
    company.id,
    email,
  );
  if (existing) throw conflict("That person is already a member.");

  const token = randomToken(24);
  const id = newId("inv");
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  await run(c.env.DB, "DELETE FROM invites WHERE company_id = ? AND email = ? AND accepted_at IS NULL", company.id, email);
  await run(
    c.env.DB,
    "INSERT INTO invites (id, company_id, email, role, token_hash, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id,
    company.id,
    email,
    role,
    await sha256Hex(token),
    c.get("user").id,
    expiresAt,
  );
  const acceptUrl = `${publicBaseUrl(c.env, c.req.raw)}/invite/${token}`;
  const emailed = await sendEmail(c.env, {
    to: email,
    subject: `${c.get("user").name} invited you to ${company.name} on FreshQA`,
    html: `<p>${c.get("user").name} invited you to join <strong>${company.name}</strong> as ${role}.</p><p><a href="${acceptUrl}">Accept the invite</a></p><p>This link expires in 14 days.</p>`,
  });
  await logEvent(c.env.DB, company.id, "invite_sent", { email, role, emailed, by: c.get("user").email });
  return c.json({ invite: { id, email, role, createdAt: new Date().toISOString(), expiresAt, acceptUrl }, emailed }, 201);
});

companyRoutes.delete("/:slug/invites/:id", withCompany("members.manage"), async (c) => {
  await run(c.env.DB, "DELETE FROM invites WHERE id = ? AND company_id = ?", c.req.param("id"), c.get("company").id);
  return c.json({ ok: true });
});

companyRoutes.patch("/:slug/members/:userId", withCompany("members.manage"), async (c) => {
  const body = await readJson<{ role?: unknown }>(c);
  const role = body.role;
  const company = c.get("company");
  const targetId = c.req.param("userId");
  const target = await one<{ role: Role }>(c.env.DB, "SELECT role FROM memberships WHERE company_id = ? AND user_id = ?", company.id, targetId);
  if (!target) throw notFound("Member not found.");
  if (!isRole(role) || !assignableRoles(c.get("role")).includes(role)) throw forbidden("You cannot assign that role.");
  if (target.role === "owner" && c.get("role") !== "owner") throw forbidden("Only an owner can change another owner.");
  if (target.role === "owner" && role !== "owner" && (await countOwners(c.env.DB, company.id)) <= 1) {
    throw badRequest("Promote someone else to owner first; a company needs at least one owner.");
  }
  await run(c.env.DB, "UPDATE memberships SET role = ? WHERE company_id = ? AND user_id = ?", role, company.id, targetId);
  await logEvent(c.env.DB, company.id, "member_role_changed", { userId: targetId, role, by: c.get("user").email });
  return c.json({ ok: true });
});

companyRoutes.delete("/:slug/members/:userId", withCompany("members.manage"), async (c) => {
  const company = c.get("company");
  const targetId = c.req.param("userId");
  const target = await one<{ role: Role }>(c.env.DB, "SELECT role FROM memberships WHERE company_id = ? AND user_id = ?", company.id, targetId);
  if (!target) throw notFound("Member not found.");
  if (target.role === "owner") throw forbidden("Owners cannot be removed. Transfer ownership first.");
  if (target.role === "admin" && c.get("role") !== "owner") throw forbidden("Only an owner can remove an admin.");
  await run(c.env.DB, "DELETE FROM memberships WHERE company_id = ? AND user_id = ?", company.id, targetId);
  await logEvent(c.env.DB, company.id, "member_removed", { userId: targetId, by: c.get("user").email });
  return c.json({ ok: true });
});

/** A member may always leave, except the last owner. */
companyRoutes.post("/:slug/leave", withCompany("company.read"), async (c) => {
  const company = c.get("company");
  if (c.get("role") === "owner" && (await countOwners(c.env.DB, company.id)) <= 1) throw badRequest("You are the only owner. Transfer ownership before leaving.");
  await run(c.env.DB, "DELETE FROM memberships WHERE company_id = ? AND user_id = ?", company.id, c.get("user").id);
  return c.json({ ok: true });
});

// ---- Invite acceptance (token based) -----------------------------------------------------

export const inviteRoutes = router();

type InviteRow = { id: string; company_id: string; email: string; role: Role; expires_at: string; accepted_at: string | null; name: string };

async function loadInvite(db: D1Database, token: string) {
  return one<InviteRow>(
    db,
    `SELECT i.id, i.company_id, i.email, i.role, i.expires_at, i.accepted_at, c.name FROM invites i JOIN companies c ON c.id = i.company_id WHERE i.token_hash = ?`,
    await sha256Hex(token),
  );
}

inviteRoutes.get("/:token", async (c) => {
  const invite = await loadInvite(c.env.DB, c.req.param("token"));
  if (!invite || invite.accepted_at || invite.expires_at < new Date().toISOString()) throw notFound("This invite link is no longer valid.");
  return c.json({ invite: { companyName: invite.name, email: invite.email, role: invite.role } });
});

inviteRoutes.post("/:token/accept", requireUser, async (c) => {
  const invite = await loadInvite(c.env.DB, c.req.param("token"));
  if (!invite || invite.accepted_at || invite.expires_at < new Date().toISOString()) throw notFound("This invite link is no longer valid.");
  const user = c.get("user");
  if (invite.email !== user.email.toLowerCase()) throw forbidden(`This invite was sent to ${invite.email}. Sign in with that email to accept it.`);
  await run(c.env.DB, "INSERT OR REPLACE INTO memberships (company_id, user_id, role) VALUES (?, ?, ?)", invite.company_id, user.id, invite.role);
  await run(c.env.DB, "UPDATE invites SET accepted_at = ?, accepted_by = ? WHERE id = ?", new Date().toISOString(), user.id, invite.id);
  await logEvent(c.env.DB, invite.company_id, "invite_accepted", { email: user.email, role: invite.role });
  const slug = (await all<{ slug: string }>(c.env.DB, "SELECT slug FROM companies WHERE id = ?", invite.company_id))[0]?.slug;
  return c.json({ ok: true, slug });
});
