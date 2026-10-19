import type { AgentMode } from "../../shared/types";
import { greetingReply } from "./greeting";

export type GateDraft = { conversationalVerified?: boolean; answer: string; confidence: number; citations: string[]; needsHuman: boolean; reason: string };
export type GateInput = { mode: AgentMode; threshold: number; handoffIntent: boolean; question?: string; draft: GateDraft | null };
export type GateResult = { decision: "sent" | "shadow" | "handoff" | "review"; reason: string };

/** Case-insensitive phrase match against the company's handoff keywords ("talk to a human, refund"). */
export function detectHandoffIntent(text: string, keywordsCsv: string): boolean {
  const haystack = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  return keywordsCsv
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length >= 3)
    .some((k) => haystack.includes(k));
}

/** A request for silence suppresses this customer turn, not the next one. */
export function detectSilenceIntent(text: string): boolean {
  let message = text.trim().toLowerCase().replace(/’/g, "'");
  if (message.length > 180 || /^(?:what|why|how|can|could|should|does|is)\b/.test(message)) return false;
  // A short self-introduction before the instruction is still a request for silence.
  message = message.replace(/^(?:(?:hey|hi|hello)[,!.]?\s+)?this is (?:the )?[a-z0-9 ]{1,50}?[,.!:;]?\s+(?=(?:please\s+)?(?:don't|dont|do not)\s+(?:reply|respond|answer)\b)/, "");
  return /^(?:(?:hey|hi|ok|okay|thanks|thank you)[,!.]?\s*)?(?:(?:for now)[, ]+)?(?:please\s+)?(?:don't|dont|do not)\s+(?:reply|respond|answer)\b/.test(message)
    || /^(?:please\s+)?stop\s+(?:replying|responding|answering)\b/.test(message)
    || /^(?:no\s+(?:reply|response)\s+(?:needed|required)|no\s+need\s+to\s+(?:reply|respond|answer))\b/.test(message);
}

/** The only place that decides whether a draft reaches the customer. Read top to bottom. */
export function decide(input: GateInput): GateResult {
  if (input.mode === "off") return { decision: "review", reason: "Company agent is off. No message sent." };
  if (input.handoffIntent && input.mode === "shadow") return { decision: "shadow", reason: "Customer asked for a person. Shadow mode: no takeover or message sent." };
  if (input.handoffIntent) return { decision: "handoff", reason: "Customer asked for a person." };
  if (!input.draft) return { decision: "review", reason: "No draft was produced." };
  if (input.draft.needsHuman) return { decision: "review", reason: input.draft.reason || "The agent decided a person should answer." };
  if (!input.draft.answer.trim()) return { decision: "review", reason: "The draft was empty." };
  const greeting = greetingReply(input.question ?? "");
  const isGreeting = greeting !== null && input.draft.answer === greeting;
  if (!input.draft.citations.length && !isGreeting && !input.draft.conversationalVerified) return { decision: "review", reason: "The draft is missing a valid knowledge source reference." };
  if (input.draft.confidence < input.threshold) {
    return { decision: "review", reason: `Confidence ${input.draft.confidence.toFixed(2)} is below the threshold ${input.threshold.toFixed(2)}.` };
  }
  if (input.mode === "shadow") return { decision: "shadow", reason: "Shadow mode: drafted, not sent." };
  return { decision: "sent", reason: isGreeting ? "Greeting: no knowledge excerpt needed." : input.draft.conversationalVerified ? "Conversational reply: no product facts or knowledge source needed." : "Grounded and confident." };
}
