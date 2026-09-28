import type { Role } from "../../shared/rbac";
import type { CompanyDetail, CompanySummary, Invite, Member, SetupStatus } from "../../shared/types";
import type { CompanyRow } from "../app";
import { all, batch, one, run } from "../db";
import { newId, slugify } from "../lib/ids";

export async function listCompaniesForUser(db: D1Database, userId: string): Promise<CompanySummary[]> {
  const rows = await all<{ id: string; slug: string; name: string; role: Role; mode: string | null; created_at: string }>(
    db,
    `SELECT c.id, c.slug, c.name, m.role, s.mode, c.created_at
     FROM memberships m JOIN companies c ON c.id = m.company_id
     LEFT JOIN agent_settings s ON s.company_id = c.id
     WHERE m.user_id = ? ORDER BY c.created_at DESC`,
    userId,
  );
  return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, role: r.role, mode: (r.mode ?? "off") as CompanySummary["mode"], createdAt: r.created_at }));
}

export async function createCompany(db: D1Database, name: string, userId: string): Promise<CompanyRow> {
  const id = newId("co");
  let slug = slugify(name);
  if (await one(db, "SELECT id FROM companies WHERE slug = ?", slug)) slug = `${slug}-${id.slice(-6)}`;
  await batch(db, [
    { sql: "INSERT INTO companies (id, slug, name, created_by) VALUES (?, ?, ?, ?)", params: [id, slug, name, userId] },
    { sql: "INSERT INTO memberships (company_id, user_id, role) VALUES (?, ?, 'owner')", params: [id, userId] },
    { sql: "INSERT INTO agent_settings (company_id) VALUES (?)", params: [id] },
  ]);
  return { id, slug, name, created_by: userId, created_at: new Date().toISOString() };
}

export async function getCompanyBySlug(db: D1Database, slug: string) {
  return one<CompanyRow>(db, "SELECT * FROM companies WHERE slug = ?", slug);
}

export async function getCompanyById(db: D1Database, id: string) {
  return one<CompanyRow>(db, "SELECT * FROM companies WHERE id = ?", id);
}

export async function getRole(db: D1Database, companyId: string, userId: string): Promise<Role | null> {
  const row = await one<{ role: Role }>(db, "SELECT role FROM memberships WHERE company_id = ? AND user_id = ?", companyId, userId);
  return row?.role ?? null;
}

export async function getSetupStatus(db: D1Database, companyId: string): Promise<SetupStatus> {
  const [connection, settings, knowledge, token, tests] = await Promise.all([
    one<{ verified_at: string | null; reply_agent_id: string | null }>(db, "SELECT verified_at, reply_agent_id FROM freshchat_connections WHERE company_id = ?", companyId),
    one<{ mode: string }>(db, "SELECT mode FROM agent_settings WHERE company_id = ?", companyId),
    one<{ id: string }>(db, "SELECT id FROM knowledge_versions WHERE company_id = ? AND status = 'active'", companyId),
    one<{ token_hash: string }>(db, "SELECT token_hash FROM sidebar_tokens WHERE company_id = ? AND revoked_at IS NULL LIMIT 1", companyId),
    one<{ total: number; failed: number; unrun: number }>(
      db,
      `SELECT COUNT(*) AS total, SUM(CASE WHEN last_result = 'fail' THEN 1 ELSE 0 END) AS failed,
              SUM(CASE WHEN last_result IS NULL THEN 1 ELSE 0 END) AS unrun FROM golden_tests WHERE company_id = ?`,
      companyId,
    ),
  ]);
  const goldenTestsPassing = !tests || tests.total === 0 || tests.unrun === tests.total ? null : tests.failed === 0;
  return {
    connected: Boolean(connection?.verified_at),
    replyAgentSet: Boolean(connection?.reply_agent_id),
    knowledgeActive: Boolean(knowledge),
    sidebarTokenIssued: Boolean(token),
    goldenTestsPassing,
    mode: (settings?.mode ?? "off") as SetupStatus["mode"],
  };
}

export async function getCompanyDetail(db: D1Database, company: CompanyRow, role: Role): Promise<CompanyDetail> {
  const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const [setup, stats] = await Promise.all([
    getSetupStatus(db, company.id),
    one<{ conversationsToday: number; sentToday: number; handoffsToday: number; humanNow: number }>(
      db,
      `SELECT
        (SELECT COUNT(*) FROM conversations WHERE company_id = ?1 AND updated_at >= ?2) AS conversationsToday,
        (SELECT COUNT(*) FROM turns WHERE company_id = ?1 AND decision = 'sent' AND created_at >= ?2) AS sentToday,
        (SELECT COUNT(*) FROM turns WHERE company_id = ?1 AND decision = 'handoff' AND created_at >= ?2) AS handoffsToday,
        (SELECT COUNT(*) FROM conversations WHERE company_id = ?1 AND state = 'human') AS humanNow`,
      company.id,
      dayStart,
    ),
  ]);
  return {
    id: company.id,
    slug: company.slug,
    name: company.name,
    role,
    mode: setup.mode,
    createdAt: company.created_at,
    setup,
    stats: stats ?? { conversationsToday: 0, sentToday: 0, handoffsToday: 0, humanNow: 0 },
  };
}

export async function listMembers(db: D1Database, companyId: string): Promise<Member[]> {
  const rows = await all<{ user_id: string; email: string; name: string; role: Role; created_at: string }>(
    db,
    `SELECT m.user_id, u.email, u.name, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.company_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.name`,
    companyId,
  );
  return rows.map((r) => ({ userId: r.user_id, email: r.email, name: r.name, role: r.role, joinedAt: r.created_at }));
}

export async function listInvites(db: D1Database, companyId: string): Promise<Invite[]> {
  const rows = await all<{ id: string; email: string; role: Role; created_at: string; expires_at: string }>(
    db,
    `SELECT id, email, role, created_at, expires_at FROM invites
     WHERE company_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC`,
    companyId,
    new Date().toISOString(),
  );
  return rows.map((r) => ({ id: r.id, email: r.email, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at }));
}

export async function countOwners(db: D1Database, companyId: string) {
  const row = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM memberships WHERE company_id = ? AND role = 'owner'", companyId);
  return row?.n ?? 0;
}

export async function deleteCompany(db: D1Database, companyId: string) {
  // Child rows cascade from companies(id).
  await run(db, "DELETE FROM companies WHERE id = ?", companyId);
}
