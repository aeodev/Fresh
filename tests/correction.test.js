import { Hono } from "hono";
import { correctionRoutes } from "../worker/agent/correction-routes";
import { sha256Hex } from "../worker/lib/crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyCorrectionPatch, publishCorrection } from "../worker/knowledge/correction";
import { draftAnswer } from "../worker/agent/pipeline";
function database() {
  const sql = new DatabaseSync(":memory:");
  for (const name of ["0001_init.sql", "0002_typing_pace.sql", "0003_silent_turn.sql", "0004_sidebar_opt_in.sql", "0005_reply_corrections.sql"]) sql.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  function prepare(query) {
    let args = [];
    const statement = {
      bind(...values) {
        args = values;
        return statement;
      },
      async first() {
        return sql.prepare(query).get(...args) ?? null;
      },
      async all() {
        return { results: sql.prepare(query).all(...args) };
      },
      async run() {
        const result = sql.prepare(query).run(...args);
        return { success: true, meta: { changes: Number(result.changes) } };
      }
    };
    return statement;
  }
  const db = { prepare, async batch(statements) {
    sql.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      sql.exec("COMMIT");
      return results;
    } catch (e) {
      sql.exec("ROLLBACK");
      throw e;
    }
  } };
  sql.exec(`INSERT INTO users (id,email,name,password_hash) VALUES ('u','test@example.com','Test','unused');
    INSERT INTO companies (id,slug,name,created_by) VALUES ('c','test','Test','u'),('other','other','Other','u');
    INSERT INTO knowledge_versions (id,company_id,number,title,status,created_by) VALUES ('base','c',1,'Original','active','u');
    INSERT INTO knowledge_docs (id,version_id,company_id,title,source_type,content,char_count) VALUES ('doc','base','c','Policies','text','Refunds are unavailable. Shipping takes two days.',48),('untouched','base','c','Hours','text','We open at nine every day.',25);
    INSERT INTO knowledge_chunks (id,version_id,company_id,doc_id,ordinal,heading,text) VALUES ('chunk','base','c','untouched',0,'Hours','We open at nine every day.');
    INSERT INTO reply_corrections (id,company_id,source_version_id,doc_id,title,before_text,after_text,question,original_answer,corrected_answer,reason,created_by) VALUES ('rc_test','c','base','doc','Policies','Refunds are unavailable.','Refunds are available within seven days.','Can I get a refund?','No refunds.','Refunds are available within seven days.','Correct policy','u');`);
  return { sql, env: { DB: db, OPENAI_API_KEY: "test" } };
}
describe("reply corrections", () => {
  let fixture;
  beforeEach(() => {
    fixture = database();
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ data: body.input.map((_text, index) => ({ index, embedding: [1, 0] })) }), { status: 200 });
    }));
  });
  afterEach(() => {
    fixture.sql.close();
    vi.unstubAllGlobals();
  });
  it("replaces only a unique source passage", () => {
    expect(applyCorrectionPatch("Policy. Keep this.", "Policy.", "Updated policy.")).toBe("Updated policy. Keep this.");
    expect(() => applyCorrectionPatch("Policy. Policy.", "Policy.", "Updated.")).toThrow();
    expect(() => applyCorrectionPatch("Policy.", "Missing.", "Updated.")).toThrow();
  });
  it("publishes an embedded new version, preserves unrelated knowledge, and saves a test", async () => {
    const version = await publishCorrection(fixture.env, "c", "rc_test", "u");
    expect(version?.status).toBe("active");
    expect(version?.number).toBe(2);
    expect(fixture.sql.prepare("SELECT status FROM knowledge_versions WHERE id='base'").get()?.status).toBe("archived");
    const docs = fixture.sql.prepare("SELECT title,content FROM knowledge_docs WHERE version_id=?").all(version.id);
    expect(docs).toContainEqual(expect.objectContaining({ title: "Policies", content: "Refunds are available within seven days. Shipping takes two days." }));
    expect(docs).toContainEqual(expect.objectContaining({ title: "Hours", content: "We open at nine every day." }));
    expect(fixture.sql.prepare("SELECT count(*) AS n FROM golden_tests").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT count(*) AS n FROM knowledge_chunks WHERE version_id=? AND embedding IS NOT NULL").get(version.id)?.n).toBeGreaterThan(0);
    const again = await publishCorrection(fixture.env, "c", "rc_test", "u");
    expect(again?.id).toBe(version?.id);
    expect(fixture.sql.prepare("SELECT count(*) AS n FROM golden_tests").get()?.n).toBe(1);
  });
  it("rejects another company's correction", async () => {
    await expect(publishCorrection(fixture.env, "other", "rc_test", "u")).rejects.toThrow("Correction not found");
  });
  it("reuses the exact approved spelling from the published version despite old chat history", async () => {
    fixture.sql.exec("UPDATE reply_corrections SET after_text='Refunds are unavailable due to ISPPPPPPP blocking.', corrected_answer='Refunds are unavailable due to ISPPPPPPP blocking.' WHERE id='rc_test'");
    const version = await publishCorrection(fixture.env, "c", "rc_test", "u");
    fetch.mockClear();
    const result = await draftAnswer(fixture.env, { companyId: "c", companyName: "Test", agentName: "Support", persona: "", question: "Can I get a refund?", versionId: version.id, transcript: [{ role: "agent", text: "Refunds are unavailable due to ISP blocking." }] });
    expect(result.ok).toBe(true);
    expect(result.draft.answer).toBe("Refunds are unavailable due to ISPPPPPPP blocking.");
    expect(result.draft.model).toBe("approved-correction");
    expect(result.draft.citations.length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not apply a published correction when testing an earlier version", async () => {
    await publishCorrection(fixture.env, "c", "rc_test", "u");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "test model unavailable" } }), { status: 400 })));
    const result = await draftAnswer(fixture.env, { companyId: "c", companyName: "Test", agentName: "Support", persona: "", question: "Can I get a refund?", versionId: "base", transcript: [] });
    expect(result.ok).toBe(false);
    expect(fetch).toHaveBeenCalled();
  });
  it("keeps live knowledge unchanged when embeddings fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    await expect(publishCorrection(fixture.env, "c", "rc_test", "u")).rejects.toThrow();
    expect(fixture.sql.prepare("SELECT status FROM knowledge_versions WHERE id='base'").get()?.status).toBe("active");
    expect(fixture.sql.prepare("SELECT count(*) AS n FROM knowledge_versions").get()?.n).toBe(1);
  });
  it("atomically rejects a correction if live knowledge changes during embedding", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      fixture.sql.exec("UPDATE knowledge_versions SET status='archived' WHERE id='base'; INSERT INTO knowledge_versions (id,company_id,number,title,status,created_by) VALUES ('newbase','c',2,'New','active','u');");
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }));
    }));
    await expect(publishCorrection(fixture.env, "c", "rc_test", "u")).rejects.toThrow("Knowledge changed");
    expect(fixture.sql.prepare("SELECT count(*) AS n FROM golden_tests").get()?.n).toBe(0);
    expect(fixture.sql.prepare("SELECT status FROM reply_corrections WHERE id='rc_test'").get()?.status).toBe("proposed");
    expect(fixture.sql.prepare("SELECT count(*) AS n FROM knowledge_versions WHERE id='kv_test'").get()?.n).toBe(0);
  });
});


describe("correction API permissions and preview", () => {
  let fixture;
  let app;
  let headers;
  beforeEach(async () => {
    fixture = database();
    fixture.sql.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,'u','2099-01-01T00:00:00Z')").run(await sha256Hex("test-session"));
    fixture.sql.exec("INSERT INTO memberships (company_id,user_id,role) VALUES ('c','u','owner')");
    headers = { Cookie: "fq_session=test-session", "Content-Type": "application/json" };
    app = new Hono();
    app.onError((e, c) => c.json({ error: e.message }, e.status ?? 500));
    app.route("/api/companies", correctionRoutes);
  });
  afterEach(() => { fixture.sql.close(); vi.unstubAllGlobals(); });
  const previewBody = { versionId: "base", question: "Can I get a refund?", originalAnswer: "No refunds.", correctedAnswer: "Refunds are available within seven days.", chunkIds: [] };
  it("previews new knowledge without changing the live version", async () => {
    const response = await app.request("/api/companies/test/agent/corrections/preview", { method: "POST", headers, body: JSON.stringify(previewBody) }, fixture.env);
    expect(response.status).toBe(200);
    expect((await response.json()).correction.addsDocument).toBe(true);
    expect(fixture.sql.prepare("SELECT status FROM knowledge_versions WHERE id='base'").get()?.status).toBe("active");
    expect(fixture.sql.prepare("SELECT count(*) AS n FROM golden_tests").get()?.n).toBe(0);
  });
  it("requires sign-in, knowledge write access, and admin publication access", async () => {
    expect((await app.request("/api/companies/test/agent/corrections/preview", { method: "POST", body: "{}" }, fixture.env)).status).toBe(401);
    fixture.sql.exec("UPDATE memberships SET role='viewer'");
    expect((await app.request("/api/companies/test/agent/corrections/preview", { method: "POST", headers, body: JSON.stringify(previewBody) }, fixture.env)).status).toBe(403);
    fixture.sql.exec("UPDATE memberships SET role='member'");
    expect((await app.request("/api/companies/test/agent/corrections/rc_test/publish", { method: "POST", headers, body: "{}" }, fixture.env)).status).toBe(403);
  });
  it("rejects stale versions and sources from outside the selected version", async () => {
    const path = "/api/companies/test/agent/corrections/preview";
    expect((await app.request(path, { method: "POST", headers, body: JSON.stringify({ ...previewBody, versionId: "missing" }) }, fixture.env)).status).toBe(409);
    expect((await app.request(path, { method: "POST", headers, body: JSON.stringify({ ...previewBody, chunkIds: ["foreign-chunk"] }) }, fixture.env)).status).toBe(400);
  });
});
