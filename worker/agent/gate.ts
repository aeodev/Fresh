import type { AgentMode } from "../../shared/types";

export type GateDraft = { answer: string; confidence: number; citations: string[]; needsHuman: boolean; reason: string };
export type GateInput = { mode: AgentMode; threshold: number; handoffIntent: boolean; draft: GateDraft | null };
export type GateResult = { decision: "sent" | "shadow" | "handoff"; reason: string };

/** Case-insensitive phrase match against the company's handoff keywords ("talk to a human, refund"). */
export function detectHandoffIntent(text: string, keywordsCsv: string): boolean {
  const haystack = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  return keywordsCsv
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length >= 3)
    .some((k) => haystack.includes(k));
}

/** The only place that decides whether a draft reaches the customer. Read top to bottom. */
export function decide(input: GateInput): GateResult {
  if (input.handoffIntent) return { decision: "handoff", reason: "Customer asked for a person." };
  if (!input.draft) return { decision: "handoff", reason: "No draft was produced." };
  if (input.draft.needsHuman) return { decision: "handoff", reason: input.draft.reason || "The agent decided a person should answer." };
  if (!input.draft.answer.trim()) return { decision: "handoff", reason: "The draft was empty." };
  if (!input.draft.citations.length) return { decision: "handoff", reason: "The answer is not supported by any knowledge excerpt." };
  if (input.draft.confidence < input.threshold) {
    return { decision: "handoff", reason: `Confidence ${input.draft.confidence.toFixed(2)} is below the threshold ${input.threshold.toFixed(2)}.` };
  }
  if (input.mode === "shadow") return { decision: "shadow", reason: "Shadow mode: drafted, not sent." };
  return { decision: "sent", reason: "Grounded and confident." };
}
