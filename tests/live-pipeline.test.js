/* global URL, Response */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTurn } from "../worker/agent/pipeline";
import { vectorToBlob } from "../worker/knowledge/embed";

vi.mock("../worker/freshchat/connection", async importOriginal => ({
  ...await importOriginal(),
  clientFor: async env => env.testClient,
}));

describe("live turn lifecycle with real SQL and D1 byte-array results", () => {
  let sql, env, messages, output, requests, client;
  const vector = new Float32Array(512).fill(0.125);
  const customer = (id, text) => ({ id, actor_type: "user", message_type: "normal", message_parts: [{ text: { content: text } }], created_time: `2026-10-14T12:00:${String(Number(id)).padStart(2, "0")}.000Z` });
  const state = () => sql.prepare("SELECT state,needs_attention,state_reason FROM conversations WHERE id='chat'").get();
  const run = () => runTurn(env, { companyId: "c", conversationId: "chat", trigger: "test" });
  const turns = () => sql.prepare("SELECT decision,question FROM turns ORDER BY rowid").all();

  beforeEach(() => {
    sql = new DatabaseSync(":memory:");
    for (const name of readdirSync(new URL("../migrations", import.meta.url)).filter(name => name.endsWith(".sql")).sort()) sql.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
    sql.exec(`INSERT INTO users (id,email,name,password_hash) VALUES ('u','test@example.com','Test','unused');
      INSERT INTO companies (id,slug,name,created_by) VALUES ('c','apollo','Apollo','u');
      INSERT INTO agent_settings (company_id,mode,typing_pace) VALUES ('c','live','instant');
      INSERT INTO freshchat_connections (company_id,api_base_url,api_key_enc,reply_agent_id,webhook_secret,verified_at) VALUES ('c','https://freshchat.invalid','unused','our-agent','unused','2026-10-01');
      INSERT INTO knowledge_versions (id,company_id,number,title,status,created_by) VALUES ('v1','c',1,'Live','active','u'),('v2','c',2,'Unpublished','draft','u');
      INSERT INTO knowledge_docs (id,version_id,company_id,title,source_type,content,char_count) VALUES ('doc','v1','c','Plans','text','Four plans: 1, 3, 6 or 12 months.',33);
      INSERT INTO conversations (id,company_id,state,sidebar_enabled_at,agent_enabled_at) VALUES ('chat','c','agent','2026-10-01','2026-10-01');`);
    sql.prepare("INSERT INTO knowledge_chunks (id,version_id,company_id,doc_id,ordinal,heading,text,embedding) VALUES ('plans','v1','c','doc',0,'Plans','Four plans: 1, 3, 6 or 12 months.',?)").run(vectorToBlob(vector));
    const normalize = row => row && Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? Array.from(value) : value]));
    function prepare(query) {
      let args = [];
      const statement = {
        bind(...values) { args = values; return statement; },
        async first() { return normalize(sql.prepare(query).get(...args)) ?? null; },
        async all() { return { results: sql.prepare(query).all(...args).map(normalize) }; },
        async run() { const result = sql.prepare(query).run(...args); return { success: true, meta: { changes: Number(result.changes) } }; },
      };
      return statement;
    }
    const db = { prepare, async batch(statements) { sql.exec("BEGIN"); try { const result = []; for (const statement of statements) result.push(await statement.run()); sql.exec("COMMIT"); return result; } catch (error) { sql.exec("ROLLBACK"); throw error; } } };
    messages = [];
    requests = [];
    output = { answer: "We offer plans for 1, 3, 6, or 12 months.", confidence: 0.95, citations: ["plans"], needs_human: false, reason: "Supported by the plans source." };
    client = {
      getConversation: vi.fn(async () => ({ status: "open" })),
      getMessages: vi.fn(async () => messages),
      sendMessage: vi.fn(async (_id, { text }) => {
        const message = { id: `sent-${client.sendMessage.mock.calls.length}`, actor_type: "agent", actor_id: "our-agent", message_type: "normal", message_parts: [{ text: { content: text } }], created_time: "2026-10-14T12:01:00.000Z" };
        messages = [...messages, message];
        return message;
      }),
    };
    env = { DB: db, OPENAI_API_KEY: "test", testClient: client };
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      if (String(url).endsWith("/embeddings")) return Response.json({ data: [{ index: 0, embedding: Array.from(vector) }] });
      requests.push(body);
      return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }], model: "test-model" });
    }));
  });
  afterEach(() => { sql.close(); vi.unstubAllGlobals(); });

  it("stays on after the exact dev-team silence message and answers the next question once using active knowledge", async () => {
    messages.push(customer("1", "Hey this is development team, please do not reply. Thanks."));
    expect((await run()).outcome).toBe("silent");
    expect(state().state).toBe("agent");
    expect(client.sendMessage).not.toHaveBeenCalled();
    messages.push(customer("2", "What plans do you offer here?"));
    expect((await run()).outcome).toBe("sent");
    expect(requests[0].input).not.toContain("development team");
    expect(sql.prepare("SELECT knowledge_version_id FROM turns WHERE customer_message_id='2'").get().knowledge_version_id).toBe("v1");
    await run();
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
    expect(turns().map(turn => turn.decision)).toEqual(["silent", "sent"]);
  });
  it("holds unsupported replies, preserves review on duplicate events and evaluates a fresh question independently", async () => {
    output = { ...output, answer: "", citations: [], needs_human: true, reason: "Account access needed." };
    messages.push(customer("1", "What is my personal account balance?"));
    expect((await run()).outcome).toBe("review");
    expect(state()).toMatchObject({ state: "agent", needs_attention: 1 });
    await run();
    expect(state().needs_attention).toBe(1);
    expect(requests).toHaveLength(1);
    output = { ...output, answer: "Four plans: 1, 3, 6 or 12 months.", citations: ["plans"], needs_human: false };
    messages.push(customer("2", "What plans do you offer here?"));
    expect((await run()).outcome).toBe("sent");
    expect(turns()[1].question).toBe("What plans do you offer here?");
    expect(state()).toMatchObject({ state: "agent", needs_attention: 0 });
  });
  it("does not send low-confidence or uncited answers, but keeps the agent on", async () => {
    output.confidence = 0.2;
    messages.push(customer("1", "What plans do you offer?"));
    expect((await run()).outcome).toBe("review");
    output.confidence = 0.95;
    output.citations = [];
    messages.push(customer("2", "Could you check those plans?"));
    expect((await run()).outcome).toBe("review");
    expect(state().state).toBe("agent");
    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(requests).toHaveLength(3); // One low-confidence draft, then at most two uncited drafts.
  });
  it("repairs missing source IDs once without bypassing the source gate", async () => {
    output.citations = [];
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      if (String(url).endsWith("/responses") && requests.length === 1) output.citations = ["plans"];
      return originalFetch(url, init);
    }));
    messages.push(customer("1", "sorry whats the perks of each plan"));
    expect((await run()).outcome).toBe("sent");
    expect(requests).toHaveLength(2);
    expect(requests[1].instructions).toContain("previous response omitted valid source IDs");
    expect(requests[0].text.format.schema.properties.citations.items.enum).toEqual(["plans"]);
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("allows independently verified conversation without knowledge citations", async () => {
    output = { ...output, reply_kind: "conversational", answer: "You're welcome!", citations: [] };
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      if (String(url).endsWith("/responses") && JSON.parse(init.body).text.format.name === "conversational_reply_check") {
        return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ safe: true }) }] }] });
      }
      return originalFetch(url, init);
    }));
    messages.push(customer("1", "thanks a lot"));
    expect((await run()).outcome).toBe("sent");
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("blocks factual claims mislabeled as conversation", async () => {
    output = { ...output, reply_kind: "conversational", answer: "Your refund is approved.", citations: [] };
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      if (String(url).endsWith("/responses") && JSON.parse(init.body).text.format.name === "conversational_reply_check") {
        return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ safe: false }) }] }] });
      }
      return originalFetch(url, init);
    }));
    messages.push(customer("1", "thanks, is my refund approved?"));
    expect((await run()).outcome).toBe("review");
    expect(client.sendMessage).not.toHaveBeenCalled();
  });
  it("recovers a factual simplification mislabeled as conversation", async () => {
    output = { ...output, reply_kind: "conversational", citations: [] };
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.text?.format.name === "conversational_reply_check") {
        return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ safe: false }) }] }] });
      }
      if (body.instructions?.includes("previous attempt was rejected")) output = { ...output, reply_kind: "factual", citations: ["plans"] };
      return originalFetch(url, init);
    }));
    messages.push(customer("1", "wait sorry i dont get it, explain simply"));
    expect((await run()).outcome).toBe("sent");
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("still hands over for an explicit person request", async () => {
    messages.push(customer("1", "I want to talk to a human"));
    expect((await run()).outcome).toBe("handoff");
    expect(state().state).toBe("human");
    expect(requests).toHaveLength(0);
  });
  it("stops on teammate takeover and refuses chats without sidebar permission", async () => {
    messages.push(customer("1", "What plans do you offer?"));
    messages.push({ ...customer("2", "I'll help you."), actor_type: "agent", actor_id: "teammate" });
    expect((await run()).outcome).toBe("skipped:teammate_replied");
    expect(state().state).toBe("human");
    sql.exec("UPDATE conversations SET state='agent', sidebar_enabled_at=NULL");
    expect((await run()).outcome).toBe("skipped:not_enabled_in_sidebar");
    expect(client.sendMessage).not.toHaveBeenCalled();
  });
  it("never sends in shadow mode and does not transfer ownership on a shadow human request", async () => {
    sql.exec("UPDATE agent_settings SET mode='shadow'");
    messages.push(customer("1", "What plans do you offer?"));
    expect((await run()).outcome).toBe("shadow");
    messages.push(customer("2", "I want to talk to a human"));
    expect((await run()).outcome).toBe("shadow");
    expect(state().state).toBe("agent");
    expect(client.sendMessage).not.toHaveBeenCalled();
  });
  it("flags an uncertain send without pausing or retrying its public message", async () => {
    client.sendMessage.mockRejectedValue(new Error("Network timeout after send"));
    messages.push(customer("1", "What plans do you offer?"));
    expect((await run()).outcome).toBe("error:partial_send");
    expect(state()).toMatchObject({ state: "agent", needs_attention: 1 });
    await run();
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("does not send a stale reply if the customer writes during drafting", async () => {
    messages.push(customer("1", "What plans do you offer?"));
    client.getMessages.mockImplementationOnce(async () => messages).mockImplementation(async () => [...messages, customer("2", "Please do not reply")]);
    expect((await run()).outcome).toBe("interrupted");
    expect(state().state).toBe("agent");
    expect(client.sendMessage).not.toHaveBeenCalled();
  });
  it("rechecks company Live mode immediately before sending", async () => {
    messages.push(customer("1", "What plans do you offer?"));
    client.getMessages.mockImplementationOnce(async () => messages).mockImplementation(async () => {
      sql.exec("UPDATE agent_settings SET mode='off'");
      return messages;
    });
    expect((await run()).outcome).toBe("interrupted");
    expect(client.sendMessage).not.toHaveBeenCalled();
  });
  it("holds a reply when the final Freshchat read fails without pausing or replaying it", async () => {
    messages.push(customer("1", "What plans do you offer?"));
    client.getMessages.mockImplementationOnce(async () => messages).mockRejectedValue(new Error("Freshchat unavailable"));
    expect((await run()).outcome).toBe("error:before_send");
    expect(state()).toMatchObject({ state: "agent", needs_attention: 1 });
    expect(client.sendMessage).not.toHaveBeenCalled();
  });
});
