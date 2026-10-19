import type { Citation, ConversationDetail, ConversationRow, ConversationState, EventRow, Message, Turn, TurnDecision } from "../../shared/types";
import { all, batch, one, run } from "../db";
import type { NormalizedMessage } from "../freshchat/events";

export type ConversationDbRow = {
  id: string;
  company_id: string;
  state: ConversationState;
  state_reason: string;
  freshchat_status: string | null;
  assigned_agent_id: string | null;
  user_id: string | null;
  channel_id: string | null;
  customer_name: string | null;
  last_customer_message_at: string | null;
  last_agent_message_at: string | null;
  last_message_preview: string;
  turn_count: number;
  needs_attention: number;
  agent_enabled_at: string | null;
  sidebar_enabled_at: string | null;
  created_at: string;
  updated_at: string;
  last_message_at?: string | null;
  last_message_actor_type?: string | null;
  last_message_turn_id?: string | null;
};

export async function getConversation(db: D1Database, companyId: string, id: string) {
  return one<ConversationDbRow>(db, "SELECT * FROM conversations WHERE company_id = ? AND id = ?", companyId, id);
}

/** Creates or refreshes the Freshchat facts on a conversation. Never touches `state`; that is ours. */
export async function upsertConversation(
  db: D1Database,
  input: { companyId: string; id: string; freshchatStatus?: string | null; assignedAgentId?: string | null; replaceAssignment?: boolean; userId?: string | null; channelId?: string | null; customerName?: string | null },
): Promise<ConversationDbRow> {
  const now = new Date().toISOString();
  await run(
    db,
    `INSERT INTO conversations (id, company_id, freshchat_status, assigned_agent_id, user_id, channel_id, customer_name, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
     ON CONFLICT(company_id, id) DO UPDATE SET
       freshchat_status = COALESCE(?3, conversations.freshchat_status),
       assigned_agent_id = CASE WHEN ?9 = 1 THEN ?4 ELSE COALESCE(?4, conversations.assigned_agent_id) END,
       user_id = COALESCE(?5, conversations.user_id),
       channel_id = COALESCE(?6, conversations.channel_id),
       customer_name = COALESCE(?7, conversations.customer_name),
       updated_at = ?8`,
    input.id,
    input.companyId,
    input.freshchatStatus ?? null,
    input.assignedAgentId ?? null,
    input.userId ?? null,
    input.channelId ?? null,
    input.customerName ?? null,
    now,
    input.replaceAssignment ? 1 : 0,
  );
  return (await getConversation(db, input.companyId, input.id))!;
}

/** Stores messages we have not seen and refreshes the conversation's "last …" columns. */
export async function upsertMessages(db: D1Database, companyId: string, messages: NormalizedMessage[], turnId: string | null = null) {
  if (!messages.length) return;
  await batch(
    db,
    messages.map((m) => ({
      sql: `INSERT INTO messages (id, company_id, conversation_id, actor_type, actor_id, message_type, text, created_time, turn_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET text = excluded.text, turn_id = COALESCE(messages.turn_id, excluded.turn_id)`,
      params: [m.id, companyId, m.conversationId, m.actorType, m.actorId, m.messageType, m.text, m.createdTime, turnId],
    })),
  );
  const byConversation = new Map<string, NormalizedMessage[]>();
  for (const m of messages) byConversation.set(m.conversationId, [...(byConversation.get(m.conversationId) ?? []), m]);
  for (const [conversationId] of byConversation) {
    await run(
      db,
      `UPDATE conversations SET
         last_customer_message_at = (SELECT MAX(created_time) FROM messages WHERE company_id = ?1 AND conversation_id = ?2 AND actor_type = 'user' AND message_type = 'normal'),
         last_agent_message_at = (SELECT MAX(created_time) FROM messages WHERE company_id = ?1 AND conversation_id = ?2 AND actor_type IN ('agent','bot') AND message_type = 'normal'),
         last_message_preview = COALESCE((SELECT substr(text, 1, 140) FROM messages WHERE company_id = ?1 AND conversation_id = ?2 AND message_type = 'normal' AND text != '' ORDER BY created_time DESC LIMIT 1), ''),
         updated_at = ?3
       WHERE company_id = ?1 AND id = ?2`,
      companyId,
      conversationId,
      new Date().toISOString(),
    );
  }
}

export async function setState(db: D1Database, companyId: string, id: string, state: ConversationState, reason: string, needsAttention = false) {
  await run(
    db,
    "UPDATE conversations SET state = ?, state_reason = ?, needs_attention = ?, sidebar_enabled_at = CASE WHEN ? = 'resolved' THEN NULL ELSE sidebar_enabled_at END, updated_at = ? WHERE company_id = ? AND id = ?",
    state,
    reason.slice(0, 300),
    needsAttention ? 1 : 0,
    state,
    new Date().toISOString(),
    companyId,
    id,
  );
}

/** The Freshchat sidebar is the sole entry point for allowing replies in this conversation. */
export async function enableAgentFromSidebar(db: D1Database, companyId: string, id: string, reason: string) {
  await upsertConversation(db, { companyId, id });
  const now = new Date().toISOString();
  await run(db, "UPDATE conversations SET state = 'agent', state_reason = ?, agent_enabled_at = ?, sidebar_enabled_at = ?, needs_attention = 0, updated_at = ? WHERE company_id = ? AND id = ?", reason.slice(0, 300), now, now, now, companyId, id);
}

export async function disableAgentFromSidebar(db: D1Database, companyId: string, id: string, reason: string) {
  await upsertConversation(db, { companyId, id });
  await run(db, "UPDATE conversations SET state = 'human', state_reason = ?, sidebar_enabled_at = NULL, needs_attention = 0, updated_at = ? WHERE company_id = ? AND id = ?", reason.slice(0, 300), new Date().toISOString(), companyId, id);
}

export async function hasTurnFor(db: D1Database, companyId: string, conversationId: string, customerMessageId: string) {
  return Boolean(await one(db, "SELECT id FROM turns WHERE company_id = ? AND conversation_id = ? AND customer_message_id = ?", companyId, conversationId, customerMessageId));
}

export type NewTurn = {
  id: string;
  companyId: string;
  conversationId: string;
  customerMessageId: string;
  question: string;
  answer: string;
  confidence: number;
  citations: Citation[];
  decision: TurnDecision;
  reason: string;
  model: string;
  latencyMs: number;
  freshchatMessageId: string | null;
  knowledgeVersionId: string | null;
};

export async function insertTurn(db: D1Database, turn: NewTurn) {
  const result = await run(
    db,
    `INSERT OR IGNORE INTO turns (id, company_id, conversation_id, customer_message_id, question, answer, confidence, citations_json, decision, reason, model, latency_ms, freshchat_message_id, knowledge_version_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    turn.id,
    turn.companyId,
    turn.conversationId,
    turn.customerMessageId,
    turn.question,
    turn.answer,
    turn.confidence,
    JSON.stringify(turn.citations),
    turn.decision,
    turn.reason,
    turn.model,
    turn.latencyMs,
    turn.freshchatMessageId,
    turn.knowledgeVersionId,
  );
  if (result.meta.changes) {
    await run(db, "UPDATE conversations SET turn_count = turn_count + 1, updated_at = ? WHERE company_id = ? AND id = ?", new Date().toISOString(), turn.companyId, turn.conversationId);
  }
  return Boolean(result.meta.changes);
}

const toRow = (r: ConversationDbRow): ConversationRow => ({
  id: r.id,
  state: r.state,
  sidebarEnabled: Boolean(r.sidebar_enabled_at),
  stateReason: r.state_reason,
  freshchatStatus: r.freshchat_status,
  customerName: r.customer_name,
  lastMessagePreview: r.last_message_preview,
  lastMessageAt: r.last_message_at ?? null,
  lastMessageActorType: r.last_message_actor_type ?? null,
  lastMessageTurnId: r.last_message_turn_id ?? null,
  lastCustomerMessageAt: r.last_customer_message_at,
  lastAgentMessageAt: r.last_agent_message_at,
  turnCount: r.turn_count,
  needsAttention: Boolean(r.needs_attention),
  updatedAt: r.updated_at,
});

export async function listConversations(db: D1Database, companyId: string, filter: { view?: string; status?: string; state?: string; attention?: boolean; limit?: number }) {
  const clauses = ["company_id = ?"];
  const params: (string | number)[] = [companyId];
  if (filter.view === "open" || filter.view === "unresolved") clauses.push("LOWER(freshchat_status) IN ('new', 'assigned', 'reopened')");
  else if (filter.view === "open_unassigned") clauses.push("LOWER(freshchat_status) IN ('new', 'assigned', 'reopened') AND NULLIF(TRIM(assigned_agent_id), '') IS NULL");
  else if (filter.view === "open_assigned") clauses.push("LOWER(freshchat_status) IN ('new', 'assigned', 'reopened') AND NULLIF(TRIM(assigned_agent_id), '') IS NOT NULL");
  else if (filter.view === "resolved") clauses.push("LOWER(freshchat_status) = 'resolved'");
  else if (filter.view === "attention") clauses.push("needs_attention = 1");
  else if (filter.view && ["agent", "human"].includes(filter.view)) {
    clauses.push("state = ?");
    params.push(filter.view);
    if (filter.view === "agent") clauses.push("sidebar_enabled_at IS NOT NULL");
  }
  if (!filter.view && filter.state && ["agent", "human", "resolved"].includes(filter.state)) {
    clauses.push("state = ?");
    params.push(filter.state);
  }
  if (!filter.view && filter.attention) clauses.push("needs_attention = 1");
  if (filter.status === "open") clauses.push("freshchat_status IS NOT NULL AND LOWER(freshchat_status) != 'resolved'");
  else if (filter.status === "resolved") clauses.push("LOWER(freshchat_status) = 'resolved'");
  params.push(Math.min(2000, Math.max(1, filter.limit ?? 100)));
  const rows = await all<ConversationDbRow>(db, `SELECT conversations.*,
    (SELECT created_time FROM messages m WHERE m.company_id = conversations.company_id AND m.conversation_id = conversations.id AND m.message_type = 'normal' AND m.text != '' ORDER BY m.created_time DESC LIMIT 1) AS last_message_at,
    (SELECT actor_type FROM messages m WHERE m.company_id = conversations.company_id AND m.conversation_id = conversations.id AND m.message_type = 'normal' AND m.text != '' ORDER BY m.created_time DESC LIMIT 1) AS last_message_actor_type,
    (SELECT turn_id FROM messages m WHERE m.company_id = conversations.company_id AND m.conversation_id = conversations.id AND m.message_type = 'normal' AND m.text != '' ORDER BY m.created_time DESC LIMIT 1) AS last_message_turn_id
    FROM conversations WHERE ${clauses.join(" AND ")}
    ORDER BY CASE WHEN COALESCE(last_customer_message_at, '') >= COALESCE(last_agent_message_at, '') THEN COALESCE(last_customer_message_at, updated_at) ELSE COALESCE(last_agent_message_at, updated_at) END DESC LIMIT ?`, ...params);
  return rows.map(toRow);
}

export async function conversationViewCounts(db: D1Database, companyId: string, status = "open") {
  const statusClause = status === "open" ? "freshchat_status IS NOT NULL AND LOWER(freshchat_status) != 'resolved'" : status === "resolved" ? "LOWER(freshchat_status) = 'resolved'" : "1 = 1";
  const result = await one<{ all: number; total: number; openAttention: number; attention: number; agent: number; human: number }>(db, `SELECT
    COUNT(*) AS "all",
    (SELECT COUNT(*) FROM conversations WHERE company_id = ?1) AS total,
    (SELECT COUNT(*) FROM conversations WHERE company_id = ?1 AND needs_attention = 1 AND freshchat_status IS NOT NULL AND LOWER(freshchat_status) != 'resolved') AS openAttention,
    COALESCE(SUM(CASE WHEN needs_attention = 1 THEN 1 ELSE 0 END), 0) AS attention,
    COALESCE(SUM(CASE WHEN state = 'agent' AND sidebar_enabled_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS agent,
    COALESCE(SUM(CASE WHEN state = 'human' THEN 1 ELSE 0 END), 0) AS human
    FROM conversations WHERE company_id = ?1 AND ${statusClause}`, companyId);
  return result ?? { all: 0, total: 0, openAttention: 0, attention: 0, agent: 0, human: 0 };
}

type TurnRow = { id: string; customer_message_id: string; question: string; answer: string; confidence: number; citations_json: string; decision: TurnDecision; reason: string; model: string; latency_ms: number; created_at: string };

export const toTurn = (t: TurnRow): Turn => ({
  id: t.id,
  customerMessageId: t.customer_message_id,
  question: t.question,
  answer: t.answer,
  confidence: t.confidence,
  citations: JSON.parse(t.citations_json || "[]") as Citation[],
  decision: t.decision,
  reason: t.reason,
  model: t.model,
  latencyMs: t.latency_ms,
  createdAt: t.created_at,
});

export async function lastTurn(db: D1Database, companyId: string, conversationId: string): Promise<Turn | null> {
  const row = await one<TurnRow>(db, "SELECT * FROM turns WHERE company_id = ? AND conversation_id = ? ORDER BY created_at DESC LIMIT 1", companyId, conversationId);
  return row ? toTurn(row) : null;
}

export async function getDetail(db: D1Database, companyId: string, id: string): Promise<ConversationDetail | null> {
  const conversation = await getConversation(db, companyId, id);
  if (!conversation) return null;
  const [messages, turns, events] = await Promise.all([
    all<{ id: string; actor_type: string; actor_id: string | null; message_type: string; text: string; created_time: string; turn_id: string | null }>(db, "SELECT id, actor_type, actor_id, message_type, text, created_time, turn_id FROM messages WHERE company_id = ? AND conversation_id = ? ORDER BY created_time", companyId, id),
    all<TurnRow>(db, "SELECT * FROM turns WHERE company_id = ? AND conversation_id = ? ORDER BY created_at", companyId, id),
    all<{ id: string; conversation_id: string | null; type: string; detail_json: string; created_at: string }>(db, "SELECT id, conversation_id, type, detail_json, created_at FROM events WHERE company_id = ? AND conversation_id = ? ORDER BY created_at DESC LIMIT 100", companyId, id),
  ]);
  const toMessage = (m: (typeof messages)[number]): Message => ({ id: m.id, actorType: m.actor_type, actorId: m.actor_id, messageType: m.message_type, text: m.text, createdTime: m.created_time, turnId: m.turn_id });
  const toEvent = (e: (typeof events)[number]): EventRow => ({ id: e.id, conversationId: e.conversation_id, type: e.type, detail: JSON.parse(e.detail_json || "{}"), createdAt: e.created_at });
  return { conversation: toRow(conversation), messages: messages.map(toMessage), turns: turns.map(toTurn), events: events.map(toEvent) };
}

export async function listEvents(db: D1Database, companyId: string, limit = 100): Promise<EventRow[]> {
  const rows = await all<{ id: string; conversation_id: string | null; type: string; detail_json: string; created_at: string }>(db, "SELECT id, conversation_id, type, detail_json, created_at FROM events WHERE company_id = ? ORDER BY created_at DESC LIMIT ?", companyId, Math.min(500, limit));
  return rows.map((e) => ({ id: e.id, conversationId: e.conversation_id, type: e.type, detail: JSON.parse(e.detail_json || "{}"), createdAt: e.created_at }));
}
