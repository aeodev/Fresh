// Entry point. Routes are mounted here and nowhere else; read this file to see the whole API surface.

import { Hono } from "hono";
import { analysisRoutes } from "./analysis/routes";
import { processAnalyses } from "./analysis/engine";
import { agentRoutes } from "./agent/routes";
import { correctionRoutes } from "./agent/correction-routes";
import type { AppEnv } from "./app";
import { authRoutes } from "./auth/routes";
import { companyRoutes, inviteRoutes } from "./companies/routes";
import { conversationObjectId } from "./conversations/object";
import { conversationRoutes } from "./conversations/routes";
import { all } from "./db";
import type { Env } from "./env";
import { ingestRoutes } from "./freshchat/ingest-routes";
import { connectionRoutes } from "./freshchat/routes";
import { knowledgeRoutes } from "./knowledge/routes";
import { HttpError } from "./lib/http";
import { sidebarRoutes, sidebarTokenRoutes } from "./sidebar/routes";

export { ConversationObject } from "./conversations/object";

const app = new Hono<AppEnv>();

app.onError((error, c) => {
  if (error instanceof HttpError) return c.json({ error: error.message, code: error.code ?? null }, error.status);
  console.error(error);
  return c.json({ error: error instanceof Error ? error.message : "Something went wrong." }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true, app: c.env.APP_NAME, release: "2026-10-15-conversation-analysis", time: new Date().toISOString() }));

app.route("/api/auth", authRoutes); //              signup, login, logout, me
app.route("/api/companies", companyRoutes); //      companies, members, invites
app.route("/api/companies", connectionRoutes); //   :slug/connection…
app.route("/api/companies", knowledgeRoutes); //    :slug/knowledge…
app.route("/api/companies", agentRoutes); //        :slug/agent/settings, test-chat, tests
app.route("/api/companies", correctionRoutes);
app.route("/api/companies", analysisRoutes);
app.route("/api/companies", conversationRoutes); // :slug/conversations…, :slug/events
app.route("/api/companies", sidebarTokenRoutes); // :slug/sidebar-tokens
app.route("/api/invites", inviteRoutes); //         :token, :token/accept
app.route("/api/ingest", ingestRoutes); //          freshchat/:companyId/:secret   (Freshchat → FreshQA)
app.route("/api/sidebar", sidebarRoutes); //        conversation, events, install (Freshchat app → FreshQA)

app.notFound((c) => c.json({ error: "Not found." }, 404));

/**
 * Safety net for missed webhooks: every 10 minutes, poke conversations that have an unanswered
 * customer message from the last 30 minutes. The pipeline is idempotent, so this is cheap and safe.
 */
async function reconcile(env: Env) {
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const rows = await all<{ company_id: string; id: string }>(
    env.DB,
    `SELECT c.company_id, c.id FROM conversations c
     JOIN agent_settings s ON s.company_id = c.company_id
     WHERE s.mode != 'off' AND c.state = 'agent' AND c.sidebar_enabled_at IS NOT NULL AND c.last_customer_message_at > ?
       AND (c.last_agent_message_at IS NULL OR c.last_agent_message_at < c.last_customer_message_at)
     ORDER BY c.last_customer_message_at DESC LIMIT 50`,
    since,
  );
  await Promise.all(
    rows.map((row) =>
      env.CONVERSATIONS.get(conversationObjectId(env, row.company_id, row.id)).notify({ companyId: row.company_id, conversationId: row.id, kind: "customer_message", debounceMs: 0 }),
    ),
  );
}

export default {
  fetch: app.fetch,
  scheduled: (_controller: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(Promise.allSettled([reconcile(env), processAnalyses(env)])),
} satisfies ExportedHandler<Env>;
