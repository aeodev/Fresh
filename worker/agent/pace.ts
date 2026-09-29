// How long a person would plausibly take before this reply appears in the chat.
// Reading the customer's message plus typing the answer, minus the time we already spent drafting.

export const PACE = {
  minMs: 1200,
  maxMs: 9000,
  readMsPerChar: 12, // ~80 wpm reading
  typeMsPerChar: 38, // ~30 wpm typing, chat-speed
};

export function humanDelayMs(input: { questionChars: number; answerChars: number; alreadySpentMs: number }): number {
  const target = PACE.minMs + input.questionChars * PACE.readMsPerChar + input.answerChars * PACE.typeMsPerChar;
  const capped = Math.min(PACE.maxMs, target);
  return Math.max(0, Math.round(capped - Math.max(0, input.alreadySpentMs)));
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
