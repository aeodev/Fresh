import type { RankedChunk } from "../knowledge/retrieve";

export type TranscriptLine = { role: "customer" | "agent"; text: string };

export type AnswerOutput = { answer: string; confidence: number; citations: string[]; needs_human: boolean; reason: string };

export const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "confidence", "citations", "needs_human", "reason"],
  properties: {
    answer: { type: "string", description: "The reply to send to the customer. Empty when needs_human is true." },
    confidence: { type: "number", description: "0 to 1: how sure you are the answer is correct and complete given the excerpts." },
    citations: { type: "array", items: { type: "string" }, description: "Ids of the excerpts the answer relies on." },
    needs_human: { type: "boolean", description: "True when a person should take this conversation." },
    reason: { type: "string", description: "One short sentence explaining the confidence or the handoff." },
  },
} as const;

export function buildInstructions(input: { companyName: string; agentName: string; persona: string }) {
  return [
    `You are ${input.agentName}, the customer support agent for ${input.companyName}, chatting with customers in a live chat widget.`,
    input.persona.trim() ? `About you and how you talk: ${input.persona.trim()}` : "",
    "",
    "Rules:",
    "1. Answer only from the knowledge excerpts you are given. Never invent prices, policies, dates, links, or steps.",
    "2. If the excerpts do not contain the answer, or the question needs account-specific data you cannot see, set needs_human to true and leave answer empty.",
    "3. If the customer explicitly asks for a person, or is clearly upset about the service, set needs_human to true.",
    "4. Write like a helpful person in chat: one to four short sentences, plain text, no markdown, no headings, no bullet lists unless listing steps.",
    "5. Reply in the customer's language.",
    "6. Put the ids of the excerpts you used in citations. Confidence must reflect how completely the excerpts answer this exact question.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function buildInput(input: { transcript: TranscriptLine[]; question: string; chunks: RankedChunk[] }) {
  const excerpts = input.chunks.length
    ? input.chunks.map((c) => `[${c.id}] ${c.heading}\n${c.text}`).join("\n\n")
    : "(no relevant excerpts were found)";
  const history = input.transcript.length
    ? input.transcript.map((line) => `${line.role === "customer" ? "Customer" : "Agent"}: ${line.text}`).join("\n")
    : "(start of conversation)";
  return [`Knowledge excerpts:\n${excerpts}`, `Conversation so far:\n${history}`, `Customer's latest message to answer:\n${input.question}`].join("\n\n");
}

export type JudgeOutput = { pass: boolean; note: string };
export const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pass", "note"],
  properties: { pass: { type: "boolean" }, note: { type: "string" } },
} as const;

export const JUDGE_INSTRUCTIONS =
  "You grade a support agent's answer against the expected answer. Pass when the answer conveys the same facts and commitments, even in different words. Fail when it contradicts the expected answer, omits a required fact, adds an unsupported claim, or hands off to a human when an answer was expected. Keep the note to one sentence.";
