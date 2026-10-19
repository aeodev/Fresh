// Two routers: `sidebarRoutes` is what the Freshchat app calls (token auth); `sidebarTokenRoutes` lets the
// dashboard issue and revoke those tokens (session auth).

import type { SidebarState } from "../../shared/types";
import { getSettings } from "../agent/pipeline";
import { router } from "../app";
import { requireUser } from "../auth/middleware";
import { withCompany } from "../companies/middleware";
import { ingestEvent } from "../conversations/ingest";
import { conversationObjectId } from "../conversations/object";
import { disableAgentFromSidebar, enableAgentFromSidebar, getConversation, lastTurn } from "../conversations/repo";
import { all, run } from "../db";
import { logEvent } from "../events";
import { getConnection } from "../freshchat/connection";
import { normalizeFreshchatEvent } from "../freshchat/events";
import { getActiveVersion } from "../knowledge/repo";
import { randomToken, sha256Hex } from "../lib/crypto";
import { publicBaseUrl } from "../lib/email";
import { badRequest, readJson, str } from "../lib/http";
import { requireSidebarToken } from "./auth";

export const sidebarRoutes = router();
sidebarRoutes.use("*", requireSidebarToken);

sidebarRoutes.get("/conversation", async (c) => {
  const company = c.get("sidebarCompany");
  const conversationId = str(c.req.query("conversationId"), 120);
  if (!conversationId) throw badRequest("conversationId is required.");
  const [settings, conversation, turn] = await Promise.all([getSettings(c.env.DB, company.id), getConversation(c.env.DB, company.id, conversationId), lastTurn(c.env.DB, company.id, conversationId)]);
  const state: SidebarState = {
    companyName: company.name,
    mode: settings.mode,
    state: conversation?.state === "resolved" || conversation?.freshchat_status?.toLowerCase() === "resolved" ? "resolved" : conversation?.sidebar_enabled_at ? conversation.state : "unknown",
    stateReason: conversation?.sidebar_enabled_at ? conversation.state_reason : "Turn on FreshQA here to allow replies in this chat.",
    lastTurn: turn,
    needsAttention: Boolean(conversation?.sidebar_enabled_at && conversation.needs_attention),
    dashboardUrl: `${publicBaseUrl(c.env, c.req.raw)}/c/${company.slug}/conversations/${encodeURIComponent(conversationId)}`,
  };
  return c.json(state, { headers: { "Cache-Control": "no-store" } });
});

sidebarRoutes.post("/conversation", async (c) => {
  const company = c.get("sidebarCompany");
  const body = await readJson<{ conversationId?: unknown; action?: unknown; actor?: unknown }>(c);
  const conversationId = str(body.conversationId, 120);
  const action = str(body.action, 40);
  const actor = body.actor && typeof body.actor === "object" ? (body.actor as Record<string, unknown>) : {};
  const actorName = str(actor.name, 120) || "Freshchat agent";
  if (!conversationId) throw badRequest("conversationId is required.");
  const stub = c.env.CONVERSATIONS.get(conversationObjectId(c.env, company.id, conversationId));
  if (action === "disable" || action === "takeover") {
    await disableAgentFromSidebar(c.env.DB, company.id, conversationId, `${actorName} took over from the sidebar`);
    await logEvent(c.env.DB, company.id, "takeover", { by: actorName, via: "sidebar" }, conversationId);
  } else if (action === "enable" || action === "handback") {
    const [settings, connection, version] = await Promise.all([getSettings(c.env.DB, company.id), getConnection(c.env.DB, company.id), getActiveVersion(c.env.DB, company.id)]);
    if (settings.mode !== "live") throw badRequest("Set this company's agent to Live in FreshQA settings first.");
    if (!connection?.verified_at || !connection.reply_agent_id) throw badRequest("Connect Freshchat and choose a reply agent first.");
    if (!version) throw badRequest("Activate a knowledge version first.");
    const current = await getConversation(c.env.DB, company.id, conversationId);
    if (current?.freshchat_status?.toLowerCase() === "resolved") throw badRequest("Reopen this conversation in Freshchat before turning on FreshQA.");
    await enableAgentFromSidebar(c.env.DB, company.id, conversationId, "Reading this chat and checking for an open customer message");
    await logEvent(c.env.DB, company.id, "handback", { by: actorName, via: "sidebar" }, conversationId);
    await stub.notify({ companyId: company.id, conversationId, kind: "customer_message", debounceMs: 0 });
  } else if (action === "reply_now") {
    const current = await getConversation(c.env.DB, company.id, conversationId);
    if (!current?.sidebar_enabled_at || current.state !== "agent") throw badRequest("Turn on FreshQA for this chat in the Freshchat sidebar first.");
    await stub.notify({ companyId: company.id, conversationId, kind: "other", debounceMs: 0 });
    const result = await stub.runNow();
    return c.json({ ok: true, result });
  } else {
    throw badRequest("action must be enable, disable, or reply_now.");
  }
  return c.json({ ok: true });
});

/** Product events forwarded by the app's serverless handlers (onMessageCreate, onConversationUpdate, …). */
sidebarRoutes.post("/events", async (c) => {
  const company = c.get("sidebarCompany");
  const connection = await getConnection(c.env.DB, company.id);
  if (!connection) return c.json({ ok: false, error: "Freshchat is not connected for this company." }, 409);
  const payload = await c.req.json().catch(() => null);
  const event = normalizeFreshchatEvent(payload);
  c.executionCtx.waitUntil(ingestEvent(c.env, company.id, connection, event, "sidebar").catch((error) => logEvent(c.env.DB, company.id, "ingest_error", { error: String(error) }, event.conversationId)));
  return c.json({ ok: true, kind: event.kind, conversationId: event.conversationId }, 202);
});

/** Called by the app on install/update so the dashboard can show the sidebar is live. */
sidebarRoutes.post("/install", async (c) => {
  const company = c.get("sidebarCompany");
  const body = await readJson<{ host?: unknown; event?: unknown }>(c).catch(() => ({}) as { host?: unknown; event?: unknown });
  await logEvent(c.env.DB, company.id, "sidebar_installed", { host: str(body.host, 200), event: str(body.event, 40) });
  return c.json({ ok: true, companyName: company.name });
});

// ---- Token management (dashboard) ------------------------------------------------------------

export const sidebarTokenRoutes = router();
sidebarTokenRoutes.use("*", requireUser);

sidebarTokenRoutes.get("/:slug/sidebar-tokens", withCompany("sidebar.tokens"), async (c) => {
  const rows = await all<{ token_hash: string; label: string; created_at: string; last_used_at: string | null }>(c.env.DB, "SELECT token_hash, label, created_at, last_used_at FROM sidebar_tokens WHERE company_id = ? AND revoked_at IS NULL ORDER BY created_at DESC", c.get("company").id);
  return c.json({ tokens: rows.map((r) => ({ id: r.token_hash.slice(0, 12), label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at })) });
});

/** Issues a token and returns it once. The dashboard shows it for copying into the Freshchat app install form. */
sidebarTokenRoutes.post("/:slug/sidebar-tokens", withCompany("sidebar.tokens"), async (c) => {
  const body = await readJson<{ label?: unknown }>(c).catch(() => ({}) as { label?: unknown });
  const token = `fq_${randomToken(30)}`;
  const company = c.get("company");
  await run(c.env.DB, "INSERT INTO sidebar_tokens (token_hash, company_id, label, created_by) VALUES (?, ?, ?, ?)", await sha256Hex(token), company.id, str(body.label, 60) || "Freshchat sidebar", c.get("user").id);
  await logEvent(c.env.DB, company.id, "sidebar_token_issued", { by: c.get("user").email });
  return c.json({ token }, 201);
});

sidebarTokenRoutes.delete("/:slug/sidebar-tokens/:id", withCompany("sidebar.tokens"), async (c) => {
  await run(c.env.DB, "UPDATE sidebar_tokens SET revoked_at = ? WHERE company_id = ? AND substr(token_hash, 1, 12) = ?", new Date().toISOString(), c.get("company").id, c.req.param("id"));
  return c.json({ ok: true });
});
