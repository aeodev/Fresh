// One function for every structured model call. Uses the OpenAI Responses API with a strict JSON schema.

import { one, run, today } from "../db";
import type { Env } from "../env";

export type StructuredOk<T> = { ok: true; value: T; model: string; latencyMs: number; tokens: number };
export type StructuredErr = { ok: false; error: string; code: string; model: string; latencyMs: number; permanent: boolean };
export type Structured<T> = StructuredOk<T> | StructuredErr;

export type StructuredRequest = {
  companyId: string;
  schemaName: string;
  schema: Record<string, unknown>;
  instructions: string;
  input: string;
  model?: string;
  reasoningEffort?: "none" | "low" | "medium";
  verbosity?: "low" | "medium" | "high";
  timeoutMs?: number;
};

export const DEFAULT_ANSWER_MODEL = "gpt-5.6-luna";

export function answerModel(env: Env) {
  return env.OPENAI_ANSWER_MODEL?.trim() || DEFAULT_ANSWER_MODEL;
}

/** Counts a request against the company's daily budget. Returns false once the limit is reached. */
async function reserve(env: Env, companyId: string) {
  const limit = Number(env.OPENAI_DAILY_REQUEST_LIMIT ?? 500) || 500;
  const day = today();
  await run(env.DB, "INSERT INTO ai_usage (company_id, day, requests) VALUES (?, ?, 1) ON CONFLICT(company_id, day) DO UPDATE SET requests = requests + 1", companyId, day);
  const row = await one<{ requests: number }>(env.DB, "SELECT requests FROM ai_usage WHERE company_id = ? AND day = ?", companyId, day);
  return (row?.requests ?? 0) <= limit;
}

async function addTokens(env: Env, companyId: string, tokens: number) {
  if (tokens > 0) await run(env.DB, "UPDATE ai_usage SET tokens = tokens + ? WHERE company_id = ? AND day = ?", tokens, companyId, today());
}

export async function structuredCompletion<T>(env: Env, request: StructuredRequest): Promise<Structured<T>> {
  const model = request.model ?? answerModel(env);
  const started = Date.now();
  if (!env.OPENAI_API_KEY) return { ok: false, error: "OPENAI_API_KEY is not set.", code: "NOT_CONFIGURED", model, latencyMs: 0, permanent: true };
  if (!(await reserve(env, request.companyId))) return { ok: false, error: "Daily AI request limit reached for this company.", code: "DAILY_LIMIT", model, latencyMs: 0, permanent: true };

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(request.timeoutMs ?? 45_000),
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: request.reasoningEffort ?? "low" },
        instructions: request.instructions,
        input: request.input,
        text: { verbosity: request.verbosity ?? "low", format: { type: "json_schema", name: request.schemaName, strict: true, schema: request.schema } },
      }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      model?: string;
      error?: { code?: string; type?: string; message?: string };
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
      usage?: { total_tokens?: number };
    };
    const latencyMs = Date.now() - started;
    await addTokens(env, request.companyId, data.usage?.total_tokens ?? 0);
    if (!response.ok) {
      const code = data.error?.code || data.error?.type || `HTTP_${response.status}`;
      const permanent = response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404;
      return { ok: false, error: data.error?.message || `OpenAI returned HTTP ${response.status}.`, code, model: data.model || model, latencyMs, permanent };
    }
    const text = data.output?.flatMap((item) => item.content ?? []).find((part) => part.type === "output_text")?.text;
    if (!text) return { ok: false, error: "The model returned no output.", code: "EMPTY_OUTPUT", model: data.model || model, latencyMs, permanent: false };
    try {
      return { ok: true, value: JSON.parse(text) as T, model: data.model || model, latencyMs, tokens: data.usage?.total_tokens ?? 0 };
    } catch {
      return { ok: false, error: "The model returned output that was not valid JSON.", code: "INVALID_OUTPUT", model: data.model || model, latencyMs, permanent: false };
    }
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return { ok: false, error: timedOut ? "OpenAI timed out." : error instanceof Error ? error.message : "OpenAI request failed.", code: timedOut ? "TIMEOUT" : "REQUEST_FAILED", model, latencyMs: Date.now() - started, permanent: false };
  }
}
