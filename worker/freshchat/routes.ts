import type { FreshchatAgentOption } from "../../shared/types";
import { router } from "../app";
import { requireUser } from "../auth/middleware";
import { withCompany } from "../companies/middleware";
import { one, run } from "../db";
import { logEvent } from "../events";
import { decryptSecret, encryptSecret, randomToken } from "../lib/crypto";
import { publicBaseUrl } from "../lib/email";
import { badRequest, readJson, str } from "../lib/http";
import { agentDisplayName, FreshchatClient, normalizeBaseUrl, type FreshchatAgent } from "./client";
import { clientFor, getConnection, toPublic } from "./connection";

export const connectionRoutes = router();
connectionRoutes.use("*", requireUser);

const toOption = (a: FreshchatAgent): FreshchatAgentOption => ({ id: a.id, name: agentDisplayName(a), email: a.email, available: a.availability_status === "AVAILABLE" });

connectionRoutes.get("/:slug/connection", withCompany("company.read"), async (c) => {
  const row = await getConnection(c.env.DB, c.get("company").id);
  return c.json({ connection: row ? await toPublic(c.env, row, publicBaseUrl(c.env, c.req.raw)) : null });
});

/** Save credentials and verify them in one step by listing agents, which the UI then offers as the reply-agent picker. */
connectionRoutes.put("/:slug/connection", withCompany("connection.manage"), async (c) => {
  const body = await readJson<{ apiBaseUrl?: unknown; apiKey?: unknown; appId?: unknown; webhookPublicKey?: unknown }>(c);
  const company = c.get("company");
  const existing = await getConnection(c.env.DB, company.id);

  let apiBaseUrl: string;
  try {
    apiBaseUrl = normalizeBaseUrl(str(body.apiBaseUrl, 300) || existing?.api_base_url || "");
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : "Invalid URL.");
  }
  const newKey = str(body.apiKey, 4000);
  if (!newKey && !existing) throw badRequest("Paste the Freshchat API key.");
  const apiKey = newKey || (await decryptSecret(existing!.api_key_enc, c.env.ENCRYPTION_KEY));
  const appId = str(body.appId, 120) || existing?.app_id || null;
  const webhookPublicKey = typeof body.webhookPublicKey === "string" ? body.webhookPublicKey.trim() || null : (existing?.webhook_public_key ?? null);
  const webhookSecret = existing?.webhook_secret ?? randomToken(24);

  let agents: FreshchatAgentOption[] = [];
  let verifyError: string | null = null;
  try {
    agents = (await new FreshchatClient(apiBaseUrl, apiKey).listAgents()).map(toOption);
  } catch (error) {
    verifyError = error instanceof Error ? error.message : "Could not reach Freshchat.";
  }

  const now = new Date().toISOString();
  await run(
    c.env.DB,
    `INSERT INTO freshchat_connections (company_id, api_base_url, api_key_enc, app_id, reply_agent_id, reply_agent_name, webhook_secret, webhook_public_key, verified_at, last_error, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
     ON CONFLICT(company_id) DO UPDATE SET api_base_url = ?2, api_key_enc = ?3, app_id = ?4, webhook_public_key = ?8,
       verified_at = COALESCE(?9, freshchat_connections.verified_at), last_error = ?10, updated_at = ?11`,
    company.id,
    apiBaseUrl,
    await encryptSecret(apiKey, c.env.ENCRYPTION_KEY),
    appId,
    existing?.reply_agent_id ?? null,
    existing?.reply_agent_name ?? null,
    webhookSecret,
    webhookPublicKey,
    verifyError ? null : now,
    verifyError,
    now,
  );
  await logEvent(c.env.DB, company.id, verifyError ? "connection_failed" : "connection_verified", { apiBaseUrl, error: verifyError, by: c.get("user").email });
  if (verifyError) throw badRequest(`Freshchat rejected the credentials: ${verifyError}`);
  const row = (await getConnection(c.env.DB, company.id))!;
  return c.json({ connection: await toPublic(c.env, row, publicBaseUrl(c.env, c.req.raw)), agents });
});

connectionRoutes.get("/:slug/connection/agents", withCompany("connection.manage"), async (c) => {
  const row = await getConnection(c.env.DB, c.get("company").id);
  if (!row) throw badRequest("Connect Freshchat first.");
  return c.json({ agents: (await (await clientFor(c.env, row)).listAgents()).map(toOption) });
});

connectionRoutes.put("/:slug/connection/reply-agent", withCompany("connection.manage"), async (c) => {
  const body = await readJson<{ agentId?: unknown; agentName?: unknown }>(c);
  const agentId = str(body.agentId, 120);
  const agentName = str(body.agentName, 120);
  if (!agentId) throw badRequest("Pick the agent profile the bot should reply as.");
  const company = c.get("company");
  if (!(await one(c.env.DB, "SELECT company_id FROM freshchat_connections WHERE company_id = ?", company.id))) throw badRequest("Connect Freshchat first.");
  await run(c.env.DB, "UPDATE freshchat_connections SET reply_agent_id = ?, reply_agent_name = ?, updated_at = ? WHERE company_id = ?", agentId, agentName || agentId, new Date().toISOString(), company.id);
  await logEvent(c.env.DB, company.id, "reply_agent_set", { agentId, agentName, by: c.get("user").email });
  return c.json({ ok: true });
});

connectionRoutes.post("/:slug/connection/rotate-webhook-secret", withCompany("connection.manage"), async (c) => {
  const company = c.get("company");
  await run(c.env.DB, "UPDATE freshchat_connections SET webhook_secret = ?, updated_at = ? WHERE company_id = ?", randomToken(24), new Date().toISOString(), company.id);
  const row = await getConnection(c.env.DB, company.id);
  return c.json({ connection: row ? await toPublic(c.env, row, publicBaseUrl(c.env, c.req.raw)) : null });
});

connectionRoutes.delete("/:slug/connection", withCompany("connection.manage"), async (c) => {
  await run(c.env.DB, "DELETE FROM freshchat_connections WHERE company_id = ?", c.get("company").id);
  await run(c.env.DB, "UPDATE agent_settings SET mode = 'off' WHERE company_id = ?", c.get("company").id);
  return c.json({ ok: true });
});
