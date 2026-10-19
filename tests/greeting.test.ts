import { describe, expect, it } from "vitest";
import { draftAnswer } from "../worker/agent/pipeline";
import { greetingReply } from "../worker/agent/greeting";
import type { Env } from "../worker/env";

describe("greetings", () => {
  it("recognizes standalone greetings, including punctuation and Tagalog", () => {
    expect(greetingReply(" Hello! ")).toBe("Hello! How can I help you today?");
    expect(greetingReply("Good morning")).toBeTruthy();
    expect(greetingReply("sup")).toBeTruthy();
    expect(greetingReply("yo!")).toBeTruthy();
    expect(greetingReply("sup, what does it cost?")).toBeNull();
    expect(greetingReply("Kumusta po?")).toBe("Kumusta! Paano kita matutulungan ngayon?");
    expect(greetingReply("hi\nWhere is my order?")).toBeNull();
    expect(greetingReply("hello, send me a refund")).toBeNull();
  });
  it("drafts a greeting without querying knowledge or calling OpenAI", async () => {
    const result = await draftAnswer({} as Env, { companyId: "test", companyName: "Test", agentName: "Support", persona: "", question: "hello", transcript: [], versionId: "test" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.answer).toBe("Hello! How can I help you today?");
      expect(result.draft.needsHuman).toBe(false);
      expect(result.chunks).toEqual([]);
    }
  });
});
