import type { AgentSettings, GoldenTest } from "../../shared/types";
import { router } from "../app";
import { requireUser } from "../auth/middleware";
import { withCompany } from "../companies/middleware";
import { all, one, run } from "../db";
import { logEvent } from "../events";
import { getConnection } from "../freshchat/connection";
import { badRequest, num, readJson, str } from "../lib/http";
import { newId } from "../lib/ids";
import { getActiveVersion, getVersion } from "../knowledge/repo";
import { decide, detectHandoffIntent } from "./gate";
import { structuredCompletion } from "./openai";
import { draftAnswer, getSettings } from "./pipeline";
import { JUDGE_INSTRUCTIONS, JUDGE_SCHEMA, type JudgeOutput, type TranscriptLine } from "./prompt";

export const agentRoutes = router();
agentRoutes.use("*", requireUser);

const toSettings = (row: Awaited<ReturnType<typeof getSettings>>): AgentSettings => ({
  mode: row.mode,
  persona: row.persona,
  confidenceThreshold: row.confidence_threshold,
  handoffKeywords: row.handoff_keywords,
  handoffMessage: row.handoff_message,
  debounceSeconds: row.debounce_seconds,
  typingPace: row.typing_pace === "instant" ? "instant" : "natural",
});

agentRoutes.get("/:slug/agent/settings", withCompany("company.read"), async (c) => c.json({ settings: toSettings(await getSettings(c.env.DB, c.get("company").id)) }));

agentRoutes.put("/:slug/agent/settings", withCompany("agent.settings"), async (c) => {
  const body = await readJson<Partial<Record<keyof AgentSettings, unknown>>>(c);
  const company = c.get("company");
  const current = await getSettings(c.env.DB, company.id);
  const mode = body.mode === undefined ? current.mode : body.mode;
  if (mode !== "off" && mode !== "shadow" && mode !== "live") throw badRequest("mode must be off, shadow, or live.");
  if (mode !== current.mode) {
    if (!(await import("../../shared/rbac")).can(c.get("role"), "agent.mode")) throw badRequest("You cannot change the agent mode.");
    if (mode === "live") {
      const connection = await getConnection(c.env.DB, company.id);
      if (!connection?.verified_at) throw badRequest("Connect Freshchat before going live.");
      if (!connection.reply_agent_id) throw badRequest("Pick the reply agent before going live.");
      if (!(await getActiveVersion(c.env.DB, company.id))) throw badRequest("Activate a knowledge version before going live.");
    }
  }
  await run(
    c.env.DB,
    "UPDATE agent_settings SET mode = ?, persona = ?, confidence_threshold = ?, handoff_keywords = ?, handoff_message = ?, debounce_seconds = ?, typing_pace = ?, updated_at = ? WHERE company_id = ?",
    mode,
    body.persona === undefined ? current.persona : str(body.persona, 2000),
    num(body.confidenceThreshold, current.confidence_threshold, 0, 1),
    body.handoffKeywords === undefined ? current.handoff_keywords : str(body.handoffKeywords, 1000),
    body.handoffMessage === undefined ? current.handoff_message : str(body.handoffMessage, 1000),
    Math.round(num(body.debounceSeconds, current.debounce_seconds, 0, 12)),
    body.typingPace === undefined ? current.typing_pace : body.typingPace === "instant" ? "instant" : "natural",
    new Date().toISOString(),
    company.id,
  );
  if (mode !== current.mode) await logEvent(c.env.DB, company.id, "mode_changed", { from: current.mode, to: mode, by: c.get("user").email });
  return c.json({ settings: toSettings(await getSettings(c.env.DB, company.id)) });
});

/** Dry run: the same retrieval and drafting as a live turn, nothing is sent anywhere. */
agentRoutes.post("/:slug/agent/test-chat", withCompany("knowledge.read"), async (c) => {
  const body = await readJson<{ messages?: unknown; versionId?: unknown }>(c);
  const company = c.get("company");
  const lines = (Array.isArray(body.messages) ? body.messages : [])
    .map((m) => (m && typeof m === "object" ? (m as Record<string, unknown>) : {}))
    .map((m) => ({ role: m.role === "agent" ? "agent" : "customer", text: str(m.text, 2000) }) as TranscriptLine)
    .filter((m) => m.text);
  const last = lines[lines.length - 1];
  if (!last || last.role !== "customer") throw badRequest("The last message must be from the customer.");
  const versionId = str(body.versionId, 60);
  const version = versionId ? await getVersion(c.env.DB, company.id, versionId) : await getActiveVersion(c.env.DB, company.id);
  if (!version) throw badRequest("Add knowledge first: activate a version or pick a draft to test.");
  const [settings, connection] = await Promise.all([getSettings(c.env.DB, company.id), getConnection(c.env.DB, company.id)]);
  const handoffIntent = detectHandoffIntent(last.text, settings.handoff_keywords);
  const result = handoffIntent
    ? null
    : await draftAnswer(c.env, {
        companyId: company.id,
        companyName: company.name,
        agentName: connection?.reply_agent_name || "the support agent",
        persona: settings.persona,
        question: last.text,
        transcript: lines.slice(0, -1).slice(-12),
        versionId: version.id,
      });
  if (result && !result.ok) throw badRequest(result.error);
  const draft = result?.ok ? result.draft : null;
  const gate = decide({
    mode: "live",
    threshold: settings.confidence_threshold,
    handoffIntent,
    draft: draft ? { answer: draft.answer, confidence: draft.confidence, citations: draft.citations.map((x) => x.chunkId), needsHuman: draft.needsHuman, reason: draft.reason } : null,
  });
  return c.json({ draft, gate, version: { id: version.id, number: version.number, status: version.status }, retrieved: result?.ok ? result.chunks.map((x) => ({ id: x.id, heading: x.heading, score: Number(x.score.toFixed(3)) })) : [] });
});

// ---- Golden tests ---------------------------------------------------------------------------

type TestRow = { id: string; question: string; expected: string; last_result: "pass" | "fail" | null; last_note: string | null; last_answer: string | null; last_run_at: string | null };
const toTest = (t: TestRow): GoldenTest => ({ id: t.id, question: t.question, expected: t.expected, lastResult: t.last_result, lastNote: t.last_note, lastAnswer: t.last_answer, lastRunAt: t.last_run_at });

agentRoutes.get("/:slug/agent/tests", withCompany("knowledge.read"), async (c) => {
  const rows = await all<TestRow>(c.env.DB, "SELECT id, question, expected, last_result, last_note, last_answer, last_run_at FROM golden_tests WHERE company_id = ? ORDER BY created_at", c.get("company").id);
  return c.json({ tests: rows.map(toTest) });
});

agentRoutes.post("/:slug/agent/tests", withCompany("knowledge.write"), async (c) => {
  const body = await readJson<{ question?: unknown; expected?: unknown }>(c);
  const question = str(body.question, 1000);
  const expected = str(body.expected, 2000);
  if (!question || !expected) throw badRequest("Both the question and the expected answer are required.");
  const id = newId("gt");
  await run(c.env.DB, "INSERT INTO golden_tests (id, company_id, question, expected, created_by) VALUES (?, ?, ?, ?, ?)", id, c.get("company").id, question, expected, c.get("user").id);
  return c.json({ test: { id, question, expected, lastResult: null, lastNote: null, lastAnswer: null, lastRunAt: null } satisfies GoldenTest }, 201);
});

agentRoutes.delete("/:slug/agent/tests/:id", withCompany("knowledge.write"), async (c) => {
  await run(c.env.DB, "DELETE FROM golden_tests WHERE company_id = ? AND id = ?", c.get("company").id, c.req.param("id"));
  return c.json({ ok: true });
});

/** Runs every golden test against a version (default: active) and stores pass/fail with the judge's note. */
agentRoutes.post("/:slug/agent/tests/run", withCompany("knowledge.write"), async (c) => {
  const body = await readJson<{ versionId?: unknown }>(c).catch(() => ({}) as { versionId?: unknown });
  const company = c.get("company");
  const versionId = str(body.versionId, 60);
  const version = versionId ? await getVersion(c.env.DB, company.id, versionId) : await getActiveVersion(c.env.DB, company.id);
  if (!version) throw badRequest("Pick a knowledge version to test.");
  const tests = await all<TestRow>(c.env.DB, "SELECT id, question, expected, last_result, last_note, last_answer, last_run_at FROM golden_tests WHERE company_id = ? ORDER BY created_at", company.id);
  if (!tests.length) throw badRequest("Add at least one test first.");
  const [settings, connection] = await Promise.all([getSettings(c.env.DB, company.id), getConnection(c.env.DB, company.id)]);
  const results: GoldenTest[] = [];
  for (const test of tests) {
    const drafted = await draftAnswer(c.env, {
      companyId: company.id,
      companyName: company.name,
      agentName: connection?.reply_agent_name || "the support agent",
      persona: settings.persona,
      question: test.question,
      transcript: [],
      versionId: version.id,
    });
    let result: "pass" | "fail" = "fail";
    let note: string;
    let answer = "";
    if (!drafted.ok) {
      note = drafted.error;
    } else {
      answer = drafted.draft.needsHuman ? "(handed off to a human)" : drafted.draft.answer;
      const judged = await structuredCompletion<JudgeOutput>(c.env, {
        companyId: company.id,
        schemaName: "golden_test_grade",
        schema: JUDGE_SCHEMA as unknown as Record<string, unknown>,
        instructions: JUDGE_INSTRUCTIONS,
        input: `Question: ${test.question}\n\nExpected answer: ${test.expected}\n\nAgent's answer: ${answer}`,
        reasoningEffort: "none",
      });
      if (judged.ok) {
        result = judged.value.pass ? "pass" : "fail";
        note = judged.value.note;
      } else {
        note = judged.error;
      }
    }
    const runAt = new Date().toISOString();
    await run(c.env.DB, "UPDATE golden_tests SET last_result = ?, last_note = ?, last_answer = ?, last_run_at = ?, last_version_id = ? WHERE id = ?", result, note, answer, runAt, version.id, test.id);
    results.push({ id: test.id, question: test.question, expected: test.expected, lastResult: result, lastNote: note, lastAnswer: answer, lastRunAt: runAt });
  }
  const passed = results.filter((r) => r.lastResult === "pass").length;
  await logEvent(c.env.DB, company.id, "golden_tests_run", { versionId: version.id, passed, total: results.length, by: c.get("user").email });
  return c.json({ tests: results, passed, total: results.length, version: { id: version.id, number: version.number } });
});

agentRoutes.get("/:slug/agent/usage", withCompany("company.read"), async (c) => {
  const row = await one<{ requests: number; tokens: number }>(c.env.DB, "SELECT requests, tokens FROM ai_usage WHERE company_id = ? AND day = ?", c.get("company").id, new Date().toISOString().slice(0, 10));
  return c.json({ today: row ?? { requests: 0, tokens: 0 } });
});
