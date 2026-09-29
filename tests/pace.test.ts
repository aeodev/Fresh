import { describe, expect, it } from "vitest";
import { humanDelayMs, PACE } from "../worker/agent/pace";

describe("humanDelayMs", () => {
  it("grows with reading and typing length and is capped", () => {
    const short = humanDelayMs({ questionChars: 20, answerChars: 60, alreadySpentMs: 0 });
    const long = humanDelayMs({ questionChars: 200, answerChars: 400, alreadySpentMs: 0 });
    expect(short).toBeGreaterThan(PACE.minMs);
    expect(long).toBe(PACE.maxMs);
  });
  it("subtracts the time already spent drafting and never goes negative", () => {
    expect(humanDelayMs({ questionChars: 20, answerChars: 60, alreadySpentMs: 1000 })).toBe(humanDelayMs({ questionChars: 20, answerChars: 60, alreadySpentMs: 0 }) - 1000);
    expect(humanDelayMs({ questionChars: 5, answerChars: 5, alreadySpentMs: 60_000 })).toBe(0);
  });
});
