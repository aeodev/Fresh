// Fast path for every Freshchat event: record what we were told, then wake the conversation's Durable Object.
// This must return quickly (Freshchat allows about three seconds), so the heavy work happens in the object.

import { getSettings } from "../agent/pipeline";
import type { Env } from "../env";
import { logEvent } from "../events";
import type { ConnectionRow } from "../freshchat/connection";
import type { IngestEvent } from "../freshchat/events";
import { conversationObjectId } from "./object";
import { getConversation, setState, upsertConversation, upsertMessages } from "./repo";

export async function ingestEvent(env: Env, companyId: string, connection: ConnectionRow, event: IngestEvent, source: "webhook" | "sidebar" | "reconcile") {
  const db = env.DB;
  if (!event.conversationId) {
    await logEvent(db, companyId, "ingest_ignored", { source, reason: event.reason ?? "no conversation id" });
    return { ok: false as const, reason: event.reason ?? "no conversation id" };
  }
  if (connection.app_id && event.appId && connection.app_id !== event.appId) {
    await logEvent(db, companyId, "ingest_ignored", { source, reason: "app_id mismatch", appId: event.appId }, event.conversationId);
    return { ok: false as const, reason: "app_id mismatch" };
  }
  const conversationId = event.conversationId;
  const existing = await getConversation(db, companyId, conversationId);
  await upsertConversation(db, {
    companyId,
    id: conversationId,
    freshchatStatus: event.status,
    assignedAgentId: event.assignedAgentId,
    userId: event.userId,
    customerName: event.customerName,
  });
  if (event.messages.length) await upsertMessages(db, companyId, event.messages);

  let wake: "customer_message" | "other" = "other";
  switch (event.kind) {
    case "customer_message":
      wake = "customer_message";
      if (existing?.state === "resolved") await setState(db, companyId, conversationId, "agent", "Customer wrote again");
      break;
    case "agent_message": {
      // A reply from anyone other than our reply agent means a teammate is handling this chat.
      const teammate = event.messages.find((m) => m.messageType === "normal" && m.actorType === "agent" && m.actorId !== connection.reply_agent_id);
      if (teammate && existing?.state !== "human") await setState(db, companyId, conversationId, "human", "A teammate replied in Freshchat");
      break;
    }
    case "resolved":
      await setState(db, companyId, conversationId, "resolved", "Resolved in Freshchat");
      break;
    case "reopened":
      await setState(db, companyId, conversationId, "agent", "Reopened in Freshchat");
      wake = "customer_message";
      break;
    case "conversation_update":
      // Unknown shape: let the object re-read the conversation; the pipeline is idempotent.
      wake = "customer_message";
      break;
    case "assignment":
    case "ignored":
      break;
  }
  await logEvent(db, companyId, "ingest", { source, kind: event.kind, messages: event.messages.length, reason: event.reason ?? null }, conversationId);

  const settings = await getSettings(db, companyId);
  const stub = env.CONVERSATIONS.get(conversationObjectId(env, companyId, conversationId));
  await stub.notify({ companyId, conversationId, kind: wake, debounceMs: settings.debounce_seconds * 1000 });
  return { ok: true as const, conversationId, kind: event.kind };
}
