import type { TranscriptLine } from "./prompt";

/** Short follow-ups need the topic and last instruction to find the next useful source. */
export function retrievalQuery(question: string, transcript: TranscriptLine[]): string {
  const followUp = /^(?:yes|yep|yeah|no|nope|ok(?:ay)?|done|got it|next|what next|what now|how much|where (?:is|do)|which one|i (?:am|don't|do not|can't|cannot|still)|i'm|it (?:says|shows|still)|that|still|help me|walk me|guide me|can you (?:explain|show|walk|guide)|please (?:explain|show|walk|guide))\b/i.test(question.trim())
    || /\b(?:explain|simplify|perks|benefits|different|difference|each|those|that|it|again)\b/i.test(question)
    || /(?:don't understand|do not understand|confused|one (?:step|thing) at a time|step by step)/i.test(question);
  if (!followUp || !transcript.length) return question;
  // The current message stays first; the recent exchange supplies the missing subject.
  return [question, ...transcript.slice(-4).map(line => line.text)].join("\n").slice(0, 4000);
}
