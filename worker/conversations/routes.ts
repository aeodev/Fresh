import { router } from "../app";
import { requireUser } from "../auth/middleware";
import { withCompany } from "../companies/middleware";
import { logEvent } from "../events";
import { badRequest, notFound, readJson, str } from "../lib/http";
import { conversationObjectId } from "./object";
import { getConversation, getDetail, listConversations, listEvents, setState } from "./repo";

export const conversationRoutes = router();
conversationRoutes.use("*", requireUser);

conversationRoutes.get("/:slug/conversations", withCompany("conversations.read"), async (c) => {
  const rows = await listConversations(c.env.DB, c.get("company").id, {
    state: c.req.query("state") || undefined,
    attention: c.req.query("attention") === "1",
    limit: Number(c.req.query("limit") ?? 100),
  });
  return c.json({ conversations: rows });
});

conversationRoutes.get("/:slug/conversations/:id", withCompany("conversations.read"), async (c) => {
  const detail = await getDetail(c.env.DB, c.get("company").id, c.req.param("id"));
  if (!detail) throw notFound("Conversation not found.");
  return c.json(detail);
});

/** Take over (state=human) or hand back to the agent (state=agent). */
conversationRoutes.post("/:slug/conversations/:id/state", withCompany("conversations.takeover"), async (c) => {
  const body = await readJson<{ state?: unknown; reason?: unknown }>(c);
  const state = body.state === "human" ? "human" : body.state === "agent" ? "agent" : null;
  if (!state) throw badRequest("state must be 'human' or 'agent'.");
  const company = c.get("company");
  const id = c.req.param("id");
  if (!(await getConversation(c.env.DB, company.id, id))) throw notFound("Conversation not found.");
  const reason = str(body.reason, 200) || (state === "human" ? `${c.get("user").name} took over` : `${c.get("user").name} handed back to the agent`);
  await setState(c.env.DB, company.id, id, state, reason, false);
  await logEvent(c.env.DB, company.id, state === "human" ? "takeover" : "handback", { by: c.get("user").email, reason }, id);
  if (state === "agent") {
    const stub = c.env.CONVERSATIONS.get(conversationObjectId(c.env, company.id, id));
    await stub.notify({ companyId: company.id, conversationId: id, kind: "customer_message", debounceMs: 0 });
  }
  return c.json({ ok: true });
});

/** Ask the agent to look at the conversation right now (after a knowledge fix, for instance). */
conversationRoutes.post("/:slug/conversations/:id/run", withCompany("conversations.takeover"), async (c) => {
  const company = c.get("company");
  const id = c.req.param("id");
  if (!(await getConversation(c.env.DB, company.id, id))) throw notFound("Conversation not found.");
  const stub = c.env.CONVERSATIONS.get(conversationObjectId(c.env, company.id, id));
  await stub.notify({ companyId: company.id, conversationId: id, kind: "other", debounceMs: 0 });
  const result = await stub.runNow();
  return c.json(result);
});

conversationRoutes.get("/:slug/events", withCompany("company.read"), async (c) => {
  return c.json({ events: await listEvents(c.env.DB, c.get("company").id, Number(c.req.query("limit") ?? 100)) });
});
