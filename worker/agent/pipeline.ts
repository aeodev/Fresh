// The agent's brain. `draftAnswer` retrieves and drafts (used by test chat, golden tests, and live turns).
// `runTurn` is the live path: re-read the conversation from Freshchat, decide, send or hand off, record.

import type { Citation, Draft } from "../../shared/types";
import { getCompanyById } from "../companies/repo";
import { one, run } from "../db";
import type { Env } from "../env";
import { logEvent } from "../events";
import { getConnection, clientFor, recordConnectionError } from "../freshchat/connection";
import { FreshchatError } from "../freshchat/client";
import type { NormalizedMessage } from "../freshchat/events";
import { newId } from "../lib/ids";
import { embedTexts } from "../knowledge/embed";
import { getActiveVersion, loadChunks } from "../knowledge/repo";
import { rankChunks, type RankedChunk } from "../knowledge/retrieve";
import { getConversation, insertTurn, setState, upsertConversation, upsertMessages, hasTurnFor, type ConversationDbRow } from "../conversations/repo";
import { decide, detectHandoffIntent } from "./gate";
import { structuredCompletion } from "./openai";
import { ANSWER_SCHEMA, buildInput, buildInstructions, type AnswerOutput, type TranscriptLine } from "./prompt";
import { findOpenCustomerTurn } from "./turn";
import { humanDelayMs, sleep } from "./pace";

export type SettingsRow = {
  company_id: string;
  mode: "off" | "shadow" | "live";
  persona: string;
  confidence_threshold: number;
  handoff_keywords: string;
  handoff_message: string;
  debounce_seconds: number;
  typing_pace: "instant" | "natural";
};

export async function getSettings(db: D1Database, companyId: string): Promise<SettingsRow> {
  const row = await one<SettingsRow>(db, "SELECT * FROM agent_settings WHERE company_id = ?", companyId);
  if (row) return row;
  await run(db, "INSERT OR IGNORE INTO agent_settings (company_id) VALUES (?)", companyId);
  return (await one<SettingsRow>(db, "SELECT * FROM agent_settings WHERE company_id = ?", companyId))!;
}

export type DraftInput = {
  companyId: string;
  companyName: string;
  agentName: string;
  persona: string;
  question: string;
  transcript: TranscriptLine[];
  versionId: string;
};

export type DraftResult = { ok: true; draft: Draft; chunks: RankedChunk[] } | { ok: false; error: string; code: string; permanent: boolean };

export async function draftAnswer(env: Env, input: DraftInput): Promise<DraftResult> {
  const chunks = await loadChunks(env.DB, input.versionId);
  let queryVector: Float32Array | null = null;
  if (chunks.some((c) => c.embedding)) {
    try {
      queryVector = (await embedTexts(env, [input.question]))?.[0] ?? null;
    } catch {
      queryVector = null; // keyword search still works
    }
  }
  const ranked = rankChunks(input.question, queryVector, chunks, 6);
  const result = await structuredCompletion<AnswerOutput>(env, {
    companyId: input.companyId,
    schemaName: "support_answer",
    schema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
    instructions: buildInstructions({ companyName: input.companyName, agentName: input.agentName, persona: input.persona }),
    input: buildInput({ transcript: input.transcript, question: input.question, chunks: ranked }),
  });
  if (!result.ok) return { ok: false, error: result.error, code: result.code, permanent: result.permanent };
  const byId = new Map(ranked.map((c) => [c.id, c]));
  const citations: Citation[] = [...new Set(result.value.citations)]
    .map((id) => byId.get(id))
    .filter((c): c is RankedChunk => Boolean(c))
    .map((c) => ({ chunkId: c.id, heading: c.heading, excerpt: c.text.slice(0, 240), score: Number(c.score.toFixed(3)) }));
  return {
    ok: true,
    chunks: ranked,
    draft: {
      answer: result.value.answer.trim(),
      confidence: Math.max(0, Math.min(1, Number(result.value.confidence) || 0)),
      citations,
      needsHuman: Boolean(result.value.needs_human),
      reason: result.value.reason.trim(),
      model: result.model,
      latencyMs: result.latencyMs,
    },
  };
}

export function toTranscript(messages: NormalizedMessage[], limit = 12): TranscriptLine[] {
  return messages
    .filter((m) => m.messageType === "normal" && m.text.trim() && (m.actorType === "user" || m.actorType === "agent" || m.actorType === "bot"))
    .slice(-limit)
    .map((m) => ({ role: m.actorType === "user" ? "customer" : "agent", text: m.text.trim().slice(0, 1500) }));
}

export type TurnOutcome = { outcome: string; detail?: Record<string, unknown> };

/** Errors that should not be retried by the Durable Object alarm. */
export class PermanentTurnError extends Error {}

export async function runTurn(env: Env, input: { companyId: string; conversationId: string; trigger: string }): Promise<TurnOutcome> {
  const db = env.DB;
  const { companyId, conversationId } = input;
  const skip = async (reason: string, detail: Record<string, unknown> = {}) => {
    await logEvent(db, companyId, "turn_skipped", { reason, trigger: input.trigger, ...detail }, conversationId);
    return { outcome: `skipped:${reason}`, detail };
  };

  const [company, connection, settings] = await Promise.all([getCompanyById(db, companyId), getConnection(db, companyId), getSettings(db, companyId)]);
  if (!company) return { outcome: "skipped:no_company" };
  if (!connection?.verified_at) return skip("not_connected");
  if (settings.mode === "off") return skip("mode_off");

  // 1. Re-read the conversation from Freshchat. The webhook payload is only a hint.
  const client = await clientFor(env, connection);
  let remote;
  let remoteMessages;
  try {
    [remote, remoteMessages] = await Promise.all([client.getConversation(conversationId), client.getMessages(conversationId)]);
  } catch (error) {
    if (error instanceof FreshchatError && !error.retryable) {
      await recordConnectionError(db, companyId, error.message);
      await logEvent(db, companyId, "turn_error", { error: error.message, stage: "read" }, conversationId);
      throw new PermanentTurnError(error.message);
    }
    throw error;
  }
  const messages: NormalizedMessage[] = remoteMessages.map((m) => ({
    id: m.id,
    conversationId,
    actorType: (m.actor_type ?? "unknown").toLowerCase(),
    actorId: m.actor_id ?? null,
    messageType: (m.message_type ?? "normal").toLowerCase(),
    text: (m.message_parts ?? []).map((p) => (typeof p.text?.content === "string" ? p.text.content : "")).filter(Boolean).join("\n").trim(),
    createdTime: m.created_time ?? new Date().toISOString(),
  }));
  let conversation: ConversationDbRow = await upsertConversation(db, {
    companyId,
    id: conversationId,
    freshchatStatus: remote.status ?? null,
    assignedAgentId: remote.assigned_agent_id ?? null,
    userId: remote.user_id ?? null,
    channelId: remote.channel_id ?? null,
  });
  await upsertMessages(db, companyId, messages);
  if (!conversation.customer_name && remote.user_id) {
    try {
      const user = await client.getUser(remote.user_id);
      const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.email || null;
      if (name) await run(db, "UPDATE conversations SET customer_name = ? WHERE company_id = ? AND id = ?", name, companyId, conversationId);
    } catch {
      // Name is cosmetic.
    }
  }

  // 2. State machine: resolved → stop; reopened → agent again; human → stop.
  if ((remote.status ?? "").toLowerCase() === "resolved") {
    if (conversation.state !== "resolved") await setState(db, companyId, conversationId, "resolved", "Resolved in Freshchat");
    return skip("resolved");
  }
  if (conversation.state === "resolved") {
    await setState(db, companyId, conversationId, "agent", "Conversation reopened");
    conversation = { ...conversation, state: "agent" };
  }
  if (conversation.state === "human") return skip("human_owns_conversation");

  // 3. A teammate replying from Freshchat takes the conversation over. Our own reply agent does not count.
  const teammate = messages.find(
    (m) => m.messageType === "normal" && m.actorType === "agent" && m.actorId !== connection.reply_agent_id && m.createdTime > conversation.created_at,
  );
  if (teammate) {
    await setState(db, companyId, conversationId, "human", "A teammate replied in Freshchat");
    return skip("teammate_replied", { messageId: teammate.id });
  }

  // 4. Is there anything to answer, and have we already answered it?
  const open = findOpenCustomerTurn(messages);
  if (!open) return skip("nothing_to_answer");
  if (await hasTurnFor(db, companyId, conversationId, open.messageId)) return skip("already_answered", { messageId: open.messageId });
  if (!connection.reply_agent_id) {
    await run(db, "UPDATE conversations SET needs_attention = 1 WHERE company_id = ? AND id = ?", companyId, conversationId);
    return skip("no_reply_agent");
  }
  const version = await getActiveVersion(db, companyId);
  if (!version) {
    await run(db, "UPDATE conversations SET needs_attention = 1 WHERE company_id = ? AND id = ?", companyId, conversationId);
    return skip("no_active_knowledge");
  }

  // 5. Draft and gate.
  const handoffIntent = detectHandoffIntent(open.text, settings.handoff_keywords);
  const transcript = toTranscript(messages.filter((m) => !open.messageIds.includes(m.id)));
  let drafted: DraftResult | null = null;
  if (!handoffIntent) {
    drafted = await draftAnswer(env, {
      companyId,
      companyName: company.name,
      agentName: connection.reply_agent_name || "the support agent",
      persona: settings.persona,
      question: open.text,
      transcript,
      versionId: version.id,
    });
    if (!drafted.ok) {
      await logEvent(db, companyId, "turn_error", { error: drafted.error, code: drafted.code, stage: "draft" }, conversationId);
      if (!drafted.permanent) throw new Error(drafted.error);
      await insertTurn(db, { id: newId("turn"), companyId, conversationId, customerMessageId: open.messageId, question: open.text, answer: "", confidence: 0, citations: [], decision: "error", reason: drafted.error, model: "", latencyMs: 0, freshchatMessageId: null, knowledgeVersionId: version.id });
      await run(db, "UPDATE conversations SET needs_attention = 1 WHERE company_id = ? AND id = ?", companyId, conversationId);
      return { outcome: "error", detail: { error: drafted.error } };
    }
  }
  const draft = drafted?.ok ? drafted.draft : null;
  const gate = decide({
    mode: settings.mode,
    threshold: settings.confidence_threshold,
    handoffIntent,
    draft: draft ? { answer: draft.answer, confidence: draft.confidence, citations: draft.citations.map((c) => c.chunkId), needsHuman: draft.needsHuman, reason: draft.reason } : null,
  });

  // 6. Act.
  const turnId = newId("turn");
  let freshchatMessageId: string | null = null;
  if (gate.decision === "sent" && draft) {
    // A person would read, then type. Land the reply on that clock, not the model's.
    if (settings.typing_pace !== "instant") {
      const wait = humanDelayMs({ questionChars: open.text.length, answerChars: draft.answer.length, alreadySpentMs: draft.latencyMs });
      if (wait > 0) await sleep(wait);
    }
    const sent = await client.sendMessage(conversationId, { text: draft.answer, actorId: connection.reply_agent_id });
    freshchatMessageId = sent.id ?? null;
    if (sent.id) {
      await upsertMessages(db, companyId, [{ id: sent.id, conversationId, actorType: "agent", actorId: connection.reply_agent_id, messageType: "normal", text: draft.answer, createdTime: sent.created_time ?? new Date().toISOString() }], turnId);
    }
  }
  if (gate.decision === "handoff") {
    await setState(db, companyId, conversationId, "human", gate.reason, true);
    if (settings.handoff_message.trim() && settings.mode === "live") {
      try {
        const sent = await client.sendMessage(conversationId, { text: settings.handoff_message.trim(), actorId: connection.reply_agent_id });
        if (sent.id) await upsertMessages(db, companyId, [{ id: sent.id, conversationId, actorType: "agent", actorId: connection.reply_agent_id, messageType: "normal", text: settings.handoff_message.trim(), createdTime: sent.created_time ?? new Date().toISOString() }], turnId);
      } catch (error) {
        await logEvent(db, companyId, "turn_error", { error: error instanceof Error ? error.message : String(error), stage: "handoff_message" }, conversationId);
      }
    }
  }
  await insertTurn(db, {
    id: turnId,
    companyId,
    conversationId,
    customerMessageId: open.messageId,
    question: open.text,
    answer: draft?.answer ?? "",
    confidence: draft?.confidence ?? 0,
    citations: draft?.citations ?? [],
    decision: gate.decision,
    reason: gate.reason,
    model: draft?.model ?? "",
    latencyMs: draft?.latencyMs ?? 0,
    freshchatMessageId,
    knowledgeVersionId: version.id,
  });
  await logEvent(db, companyId, `turn_${gate.decision}`, { reason: gate.reason, confidence: draft?.confidence ?? null, citations: draft?.citations.length ?? 0, trigger: input.trigger, turnId }, conversationId);
  const conv = await getConversation(db, companyId, conversationId);
  void conv;
  return { outcome: gate.decision, detail: { reason: gate.reason } };
}
