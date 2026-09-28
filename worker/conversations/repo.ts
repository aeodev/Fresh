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
  created_at: string;
  updated_at: string;
};

export async function getConversation(db: D1Database, companyId: string, id: string) {
  return one<ConversationDbRow>(db, "SELECT * FROM conversations WHERE company_id = ? AND id = ?", companyId, id);
}

/** Creates or refreshes the Freshchat facts on a conversation. Never touches `state`; that is ours. */
export async function upsertConversation(
  db: D1Database,
  input: { companyId: string; id: string; freshchatStatus?: string | null; assignedAgentId?: string | null; userId?: string | null; channelId?: string | null; customerName?: string | null },
): Promise<ConversationDbRow> {
  const now = new Date().toISOString();
  await run(
    db,
    `INSERT INTO conversations (id, company_id, freshchat_status, assigned_agent_id, user_id, channel_id, customer_name, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
     ON CONFLICT(company_id, id) DO UPDATE SET
       freshchat_status = COALESCE(?3, conversations.freshchat_status),
       assigned_agent_id = COALESCE(?4, conversations.assigned_agent_id),
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
    "UPDATE conversations SET state = ?, state_reason = ?, needs_attention = ?, updated_at = ? WHERE company_id = ? AND id = ?",
    state,
    reason.slice(0, 300),
    needsAttention ? 1 : 0,
    new Date().toISOString(),
    companyId,
    id,
  );
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
  stateReason: r.state_reason,
  freshchatStatus: r.freshchat_status,
  customerName: r.customer_name,
  lastMessagePreview: r.last_message_preview,
  lastCustomerMessageAt: r.last_customer_message_at,
  turnCount: r.turn_count,
  needsAttention: Boolean(r.needs_attention),
  updatedAt: r.updated_at,
});

export async function listConversations(db: D1Database, companyId: string, filter: { state?: string; attention?: boolean; limit?: number }) {
  const clauses = ["company_id = ?"];
  const params: (string | number)[] = [companyId];
  if (filter.state && ["agent", "human", "resolved"].includes(filter.state)) {
    clauses.push("state = ?");
    params.push(filter.state);
  }
  if (filter.attention) clauses.push("needs_attention = 1");
  params.push(Math.min(200, Math.max(1, filter.limit ?? 100)));
  const rows = await all<ConversationDbRow>(db, `SELECT * FROM conversations WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`, ...params);
  return rows.map(toRow);
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
