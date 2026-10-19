import { describe, expect, it } from "vitest";
import { decide, detectHandoffIntent, detectSilenceIntent } from "../worker/agent/gate";
import { greetingReply } from "../worker/agent/greeting";

const draft = { answer: "Orders ship in two days.", confidence: 0.9, citations: ["c1"], needsHuman: false, reason: "clear" };

describe("gate", () => {
  it("recognizes the dev-team silence instruction without suppressing a later question", () => {
    expect(detectSilenceIntent("hi this is dev team please do not reply, thank you")).toBe(true);
    expect(detectSilenceIntent("Hey this is development team, please do not reply. Thanks.")).toBe(true);
    expect(detectSilenceIntent("Hello, this is the development team. Please do not reply.")).toBe(true);
    expect(detectSilenceIntent("How do I subscribe to Apollo Group TV?")).toBe(false);
    expect(detectSilenceIntent("Why does this say do not reply?")).toBe(false);
  });
  it("allows a standalone greeting without citations in live and shadow mode", () => {
    const greeting = { ...draft, answer: greetingReply("hello")!, confidence: 1, citations: [] };
    expect(decide({ mode: "live", threshold: 0.6, handoffIntent: false, question: "hello", draft: greeting }).decision).toBe("sent");
    expect(decide({ mode: "shadow", threshold: 0.6, handoffIntent: false, question: "hello", draft: greeting }).decision).toBe("shadow");
  });
  it("keeps citation requirements for mixed greetings and unsupported claims", () => {
    const greeting = { ...draft, answer: greetingReply("hello")!, citations: [] };
    expect(greetingReply("hello, what are your opening hours?")).toBeNull();
    expect(decide({ mode: "live", threshold: 0.6, handoffIntent: false, question: "hello, what are your opening hours?", draft: greeting }).decision).toBe("review");
    expect(decide({ mode: "live", threshold: 0.6, handoffIntent: false, question: "hello", draft: { ...draft, citations: [] } }).decision).toBe("review");
  });
  it("preserves handoff and confidence checks for greetings", () => {
    const greeting = { ...draft, answer: greetingReply("hello")!, citations: [] };
    expect(decide({ mode: "live", threshold: 0.6, handoffIntent: true, question: "hello", draft: greeting }).decision).toBe("handoff");
    expect(decide({ mode: "live", threshold: 0.6, handoffIntent: false, question: "hello", draft: { ...greeting, needsHuman: true } }).decision).toBe("review");
    expect(decide({ mode: "live", threshold: 0.95, handoffIntent: false, question: "hello", draft: greeting }).decision).toBe("review");
  });
  it("sends a grounded, confident draft in live mode and only drafts in shadow mode", () => {
    expect(decide({ mode: "live", threshold: 0.6, handoffIntent: false, draft }).decision).toBe("sent");
    expect(decide({ mode: "shadow", threshold: 0.6, handoffIntent: false, draft }).decision).toBe("shadow");
  });
  it("hands off only on customer intent and holds uncertain answers for review", () => {
    expect(decide({ mode: "live", threshold: 0.6, handoffIntent: true, draft }).decision).toBe("handoff");
    expect(decide({ mode: "live", threshold: 0.6, handoffIntent: false, draft: { ...draft, citations: [] } }).decision).toBe("review");
    expect(decide({ mode: "live", threshold: 0.95, handoffIntent: false, draft }).decision).toBe("review");
    expect(decide({ mode: "live", threshold: 0.6, handoffIntent: false, draft: { ...draft, needsHuman: true } }).decision).toBe("review");
    expect(decide({ mode: "live", threshold: 0.6, handoffIntent: false, draft: null }).decision).toBe("review");
  });
  it("detects handoff phrases case-insensitively", () => {
    expect(detectHandoffIntent("Can I TALK TO A HUMAN please", "talk to a human, real person")).toBe(true);
    expect(detectHandoffIntent("What are your hours?", "talk to a human, real person")).toBe(false);
  });
});
