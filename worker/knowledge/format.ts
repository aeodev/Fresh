import type { Env } from "../env";
import { hasSameText } from "../../shared/knowledge-format";
import { structuredCompletion } from "../agent/openai";
import { recoverFormatting } from "./format-recovery";

const FORMAT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["formatted"],
  properties: { formatted: { type: "string" } },
} as const;

export async function formatKnowledge(env: Env, companyId: string, content: string) {
  const result = await structuredCompletion<{ formatted: string }>(env, {
    companyId,
    schemaName: "knowledge_formatting",
    schema: FORMAT_SCHEMA as unknown as Record<string, unknown>,
    reasoningEffort: "low",
    instructions: [
      "You repair the layout and OCR spacing of pasted knowledge. Change whitespace only. Return all original non-whitespace characters in exactly the same order and case.",
      "Join letters or numbers separated by erroneous spaces when the intended word, acronym, brand, or technical term is clear. Examples: N V I D I A -> NVIDIA; T V -> TV; 4 K -> 4K; H. 265 -> H.265. Keep normal spaces between distinct words.",
      "Create sensible paragraph breaks and line breaks for topics, steps, and question-answer pairs. Preserve existing Markdown markers exactly; do not add headings, bullets, or numbering.",
      "Never add, remove, reorder, correct, or paraphrase any letter, digit, punctuation mark, or symbol. If a spelling is wrong, leave it wrong.",
    ].join("\n"),
    input: content,
    timeoutMs: 40_000,
  });
  if (!result.ok) return { ok: false as const, error: result.error };
  const formatted = result.value?.formatted;
  if (typeof formatted !== "string") return { ok: true as const, formatted: content, changed: false, safeguard: "original" as const };
  if (hasSameText(content, formatted)) return { ok: true as const, formatted, changed: content !== formatted, safeguard: "exact" as const };
  const recovered = recoverFormatting(content, formatted);
  if (recovered === null) return { ok: true as const, formatted: content, changed: false, safeguard: "original" as const };
  return { ok: true as const, formatted: recovered, changed: content !== recovered, safeguard: "recovered" as const };
}
