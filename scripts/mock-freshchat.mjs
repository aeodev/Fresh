#!/usr/bin/env node
// A tiny fake Freshchat for local testing. It serves the five API calls FreshQA makes and lets you
// play the customer:  POST /mock/customer {conversationId, text}  → stores the message and fires the
// account webhook at FRESHQA_WEBHOOK_URL exactly like Freshchat would.
//
//   FRESHQA_WEBHOOK_URL=http://localhost:8787/api/ingest/freshchat/<companyId>/<secret> node scripts/mock-freshchat.mjs
//
// Then in FreshQA connect with API URL http://localhost:8790 and any API key.

import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT ?? 8790);
let WEBHOOK = process.env.FRESHQA_WEBHOOK_URL ?? "";
const agents = [
  { id: "agent-bot", first_name: "Ava", last_name: "Support", email: "ava@example.com", availability_status: "AVAILABLE" },
  { id: "agent-sam", first_name: "Sam", last_name: "Human", email: "sam@example.com", availability_status: "AVAILABLE" },
];
const conversations = new Map(); // id → { conversation, messages }

function conv(id) {
  if (!conversations.has(id)) {
    conversations.set(id, { conversation: { conversation_id: id, app_id: "app-mock", status: "new", user_id: "user-1", channel_id: "ch-1" }, messages: [] });
  }
  return conversations.get(id);
}

function addMessage(id, { actor_type, actor_id, text, message_type = "normal" }) {
  const message = { id: randomUUID(), conversation_id: id, actor_type, actor_id, message_type, created_time: new Date().toISOString(), message_parts: [{ text: { content: text } }] };
  conv(id).messages.push(message);
  return message;
}

async function fireWebhook(action, data) {
  if (!WEBHOOK) return console.log(`webhook ${action} skipped: no FRESHQA_WEBHOOK_URL (POST /mock/config {webhook})`);
  try {
    const response = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actor: { actor_type: "user", actor_id: "user-1" }, action, action_time: new Date().toISOString(), data }) });
    console.log(`webhook ${action} → ${response.status}`);
  } catch (error) {
    console.log(`webhook ${action} failed: ${error.message}`);
  }
}

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || "{}") : {};
    const path = url.pathname;
    console.log(`${req.method} ${path}${body.message_parts ? ` "${body.message_parts[0]?.text?.content}" as ${body.actor_type}/${body.actor_id}` : ""}`);

    if (req.method === "POST" && path === "/mock/customer") {
      const message = addMessage(body.conversationId, { actor_type: "user", actor_id: "user-1", text: body.text });
      await fireWebhook("message_create", { message });
      return json(res, 200, { ok: true, message });
    }
    if (req.method === "POST" && path === "/mock/human") {
      const message = addMessage(body.conversationId, { actor_type: "agent", actor_id: "agent-sam", text: body.text });
      await fireWebhook("message_create", { message });
      return json(res, 200, { ok: true, message });
    }
    if (req.method === "POST" && path === "/mock/config") {
      WEBHOOK = String(body.webhook || "");
      return json(res, 200, { ok: true, webhook: WEBHOOK });
    }
    if (req.method === "GET" && path === "/mock/dump") return json(res, 200, Object.fromEntries(conversations));

    let m;
    if (req.method === "GET" && path === "/v2/agents") return json(res, 200, { agents, pagination: { total_pages: 1 } });
    if ((m = /^\/v2\/conversations\/([^/]+)\/messages$/.exec(path)) && req.method === "GET") {
      const { messages } = conv(decodeURIComponent(m[1]));
      return json(res, 200, { messages: [...messages].reverse().slice(0, 50) });
    }
    if ((m = /^\/v2\/conversations\/([^/]+)\/messages$/.exec(path)) && req.method === "POST") {
      const message = addMessage(decodeURIComponent(m[1]), { actor_type: body.actor_type, actor_id: body.actor_id, text: body.message_parts?.[0]?.text?.content ?? "", message_type: body.message_type });
      return json(res, 200, message);
    }
    if ((m = /^\/v2\/conversations\/([^/]+)$/.exec(path)) && req.method === "GET") return json(res, 200, conv(decodeURIComponent(m[1])).conversation);
    if ((m = /^\/v2\/conversations\/([^/]+)$/.exec(path)) && req.method === "PUT") return json(res, 200, Object.assign(conv(decodeURIComponent(m[1])).conversation, body));
    if (/^\/v2\/users\//.test(path)) return json(res, 200, { id: "user-1", first_name: "Jane", last_name: "Customer", email: "jane@example.com" });
    json(res, 404, { error: "not found" });
  })
  .listen(PORT, () => console.log(`mock Freshchat on http://localhost:${PORT}  (webhook → ${WEBHOOK || "not set"})`));
