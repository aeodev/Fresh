// Turns whatever Freshchat sends us into one small, typed event. Two sources land here:
//  1. The account-level webhook (Admin → Webhooks): { action, actor, action_time, data }.
//  2. Product events forwarded by the sidebar app: { event: "onMessageCreate", data }.
// Both are documented in docs/HOW-IT-WORKS.md. Unknown shapes still yield the conversation id
// when one exists anywhere in the payload, so the agent can re-read the conversation.

import { extractText, type FreshchatMessagePart } from "./client";

export type NormalizedMessage = {
  id: string;
  conversationId: string;
  actorType: string;
  actorId: string | null;
  messageType: string;
  text: string;
  createdTime: string;
};

export type IngestEventKind =
  | "customer_message"
  | "agent_message"
  | "assignment"
  | "resolved"
  | "reopened"
  | "conversation_update"
  | "ignored";

export type IngestEvent = {
  kind: IngestEventKind;
  conversationId: string | null;
  messages: NormalizedMessage[];
  status: string | null;
  assignedAgentId: string | null;
  appId: string | null;
  customerName: string | null;
  userId: string | null;
  reason?: string;
};

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const s = (value: unknown) => (typeof value === "string" ? value : null);

function findFirst(value: unknown, key: string, depth = 0): string | null {
  if (!isObj(value) || depth > 6) return null;
  if (typeof value[key] === "string") return value[key] as string;
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findFirst(item, key, depth + 1);
        if (found) return found;
      }
    } else {
      const found = findFirst(child, key, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function toMessage(raw: unknown, fallbackConversationId: string | null): NormalizedMessage | null {
  if (!isObj(raw)) return null;
  const id = s(raw.id);
  const conversationId = s(raw.conversation_id) ?? fallbackConversationId;
  if (!id || !conversationId) return null;
  return {
    id,
    conversationId,
    actorType: (s(raw.actor_type) ?? "unknown").toLowerCase(),
    actorId: s(raw.actor_id),
    messageType: (s(raw.message_type) ?? "normal").toLowerCase(),
    text: extractText(raw.message_parts as FreshchatMessagePart[] | undefined),
    createdTime: s(raw.created_time) ?? new Date().toISOString(),
  };
}

function kindForMessages(messages: NormalizedMessage[]): IngestEventKind {
  const normal = messages.filter((m) => m.messageType === "normal");
  if (normal.some((m) => m.actorType === "user")) return "customer_message";
  if (normal.some((m) => m.actorType === "agent" || m.actorType === "bot")) return "agent_message";
  return "ignored";
}

function customerNameFrom(payload: Obj): string | null {
  const data = isObj(payload.data) ? payload.data : payload;
  const user = isObj(data.associations) && isObj((data.associations as Obj).user) ? ((data.associations as Obj).user as Obj) : isObj(data.user) ? (data.user as Obj) : null;
  if (!user) return null;
  const name = [s(user.first_name), s(user.last_name)].filter(Boolean).join(" ").trim();
  return name || s(user.email);
}

function base(payload: Obj, conversationId: string | null): IngestEvent {
  return {
    kind: "ignored",
    conversationId,
    messages: [],
    status: null,
    assignedAgentId: null,
    appId: findFirst(payload, "app_id"),
    customerName: customerNameFrom(payload),
    userId: null,
  };
}

export function normalizeFreshchatEvent(input: unknown): IngestEvent {
  if (!isObj(input)) return { ...base({}, null), reason: "payload is not an object" };
  const payload = input;
  const data = isObj(payload.data) ? payload.data : payload;
  const action = (s(payload.action) ?? s(payload.event) ?? "").trim();

  // --- Account webhook events -------------------------------------------------------------
  if (action === "message_create" && isObj(data.message)) {
    const message = toMessage(data.message, null);
    if (!message) return { ...base(payload, null), reason: "message without id" };
    const event = base(payload, message.conversationId);
    event.userId = s((data.message as Obj).user_id);
    event.messages = [message];
    event.kind = kindForMessages([message]);
    return event;
  }
  if (action === "conversation_assignment" && isObj(data.assignment)) {
    const assignment = data.assignment as Obj;
    const conversation = isObj(assignment.conversation) ? (assignment.conversation as Obj) : {};
    const event = base(payload, s(conversation.conversation_id) ?? findFirst(assignment, "conversation_id"));
    event.kind = "assignment";
    event.status = s(conversation.status);
    event.assignedAgentId = s(assignment.to_agent_id) ?? s(conversation.assigned_agent_id);
    return event;
  }
  if (action === "conversation_resolution" && isObj(data.resolve)) {
    const conversation = isObj((data.resolve as Obj).conversation) ? ((data.resolve as Obj).conversation as Obj) : {};
    const event = base(payload, s(conversation.conversation_id) ?? findFirst(data.resolve, "conversation_id"));
    event.kind = "resolved";
    event.status = "resolved";
    return event;
  }
  if (action === "conversation_reopen" && isObj(data.reopen)) {
    const conversation = isObj((data.reopen as Obj).conversation) ? ((data.reopen as Obj).conversation as Obj) : {};
    const event = base(payload, s(conversation.conversation_id) ?? findFirst(data.reopen, "conversation_id"));
    event.kind = "reopened";
    event.status = "reopened";
    return event;
  }

  // --- Product events forwarded by the sidebar app ----------------------------------------
  if (action === "onMessageCreate" && isObj(data.message)) {
    const container = data.message as Obj;
    const conversationId = s(container.conversation_id) ?? findFirst(container, "conversation_id");
    const rawMessages = Array.isArray(container.messages) ? container.messages : [container];
    const messages = rawMessages.map((m) => toMessage(m, conversationId)).filter((m): m is NormalizedMessage => Boolean(m));
    const event = base(payload, conversationId);
    event.messages = messages;
    event.status = s(container.status);
    event.userId = s(container.user_id);
    event.kind = kindForMessages(messages);
    if (event.kind === "ignored") event.reason = "no normal user/agent message in event";
    return event;
  }
  if ((action === "onConversationCreate" || action === "onConversationUpdate") && (isObj(data.conversation) || isObj(data.message))) {
    const conversation = (isObj(data.conversation) ? data.conversation : data.message) as Obj;
    const status = (s(conversation.status) ?? "").toLowerCase();
    const event = base(payload, s(conversation.conversation_id) ?? s(conversation.id) ?? findFirst(conversation, "conversation_id"));
    event.status = status || null;
    event.assignedAgentId = s(conversation.assigned_agent_id);
    event.userId = s(conversation.user_id);
    event.kind = status === "resolved" ? "resolved" : status === "reopened" ? "reopened" : "conversation_update";
    return event;
  }

  // --- Anything else: keep the conversation id so we can still re-read it ------------------
  const conversationId = findFirst(payload, "conversation_id") ?? findFirst(payload, "conversationId");
  const event = base(payload, conversationId);
  event.kind = conversationId ? "conversation_update" : "ignored";
  event.reason = conversationId ? `unrecognised action "${action || "none"}"` : "no conversation id in payload";
  return event;
}
