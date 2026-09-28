import { describe, expect, it } from "vitest";
import { normalizeFreshchatEvent } from "../worker/freshchat/events";

const conversationId = "8c65b83e-5be0-45f4-9645-9ddbbe015f4d";

describe("normalizeFreshchatEvent", () => {
  it("reads an account webhook message_create from a customer", () => {
    const event = normalizeFreshchatEvent({
      actor: { actor_type: "user", actor_id: "u1" },
      action: "message_create",
      action_time: "2026-09-28T10:00:00.000Z",
      data: { message: { id: "m1", conversation_id: conversationId, app_id: "app1", actor_type: "user", actor_id: "u1", message_type: "normal", created_time: "2026-09-28T10:00:00.000Z", message_parts: [{ text: { content: "Where is my order?" } }] } },
    });
    expect(event.kind).toBe("customer_message");
    expect(event.conversationId).toBe(conversationId);
    expect(event.messages[0].text).toBe("Where is my order?");
    expect(event.appId).toBe("app1");
  });
  it("treats an agent's normal message as agent_message and a private note as ignored", () => {
    const base = { action: "message_create", data: { message: { id: "m2", conversation_id: conversationId, actor_type: "agent", actor_id: "a1", message_parts: [{ text: { content: "Hi" } }] } } };
    expect(normalizeFreshchatEvent(base).kind).toBe("agent_message");
    expect(normalizeFreshchatEvent({ ...base, data: { message: { ...base.data.message, message_type: "private" } } }).kind).toBe("ignored");
  });
  it("reads the sidebar app's onMessageCreate product event (conversation wrapper with messages array)", () => {
    const event = normalizeFreshchatEvent({
      event: "onMessageCreate",
      data: {
        associations: { user: { first_name: "John", last_name: "Doe" } },
        message: { conversation_id: conversationId, status: "new", user_id: "u1", messages: [{ id: "m3", actor_type: "user", actor_id: "u1", message_parts: [{ text: { content: "Hey again" } }], created_time: "2026-09-28T10:01:00.000Z", message_type: "normal" }] },
      },
    });
    expect(event.kind).toBe("customer_message");
    expect(event.conversationId).toBe(conversationId);
    expect(event.customerName).toBe("John Doe");
    expect(event.messages[0].id).toBe("m3");
  });
  it("maps assignment, resolution and reopen", () => {
    expect(normalizeFreshchatEvent({ action: "conversation_assignment", data: { assignment: { to_agent_id: "a9", conversation: { conversation_id: conversationId, status: "assigned" } } } })).toMatchObject({ kind: "assignment", assignedAgentId: "a9" });
    expect(normalizeFreshchatEvent({ action: "conversation_resolution", data: { resolve: { conversation: { conversation_id: conversationId } } } }).kind).toBe("resolved");
    expect(normalizeFreshchatEvent({ action: "conversation_reopen", data: { reopen: { conversation: { conversation_id: conversationId } } } }).kind).toBe("reopened");
    expect(normalizeFreshchatEvent({ event: "onConversationUpdate", data: { conversation: { conversation_id: conversationId, status: "resolved" } } }).kind).toBe("resolved");
  });
  it("falls back to any conversation id it can find", () => {
    const event = normalizeFreshchatEvent({ something: { nested: { conversation_id: conversationId } } });
    expect(event.kind).toBe("conversation_update");
    expect(event.conversationId).toBe(conversationId);
    expect(normalizeFreshchatEvent({ nothing: true }).kind).toBe("ignored");
  });
});
