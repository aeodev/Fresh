import { describe, expect, it } from "vitest";
import { decide, detectHandoffIntent } from "../worker/agent/gate";

const draft = { answer: "Orders ship in two days.", confidence: 0.9, citations: ["c1"], needsHuman: false, reason: "clear" };

describe("gate", () => {
  it("sends a grounded, confident draft in live mode and only drafts in shadow mode", () => {
    expect(decide({ mode: "live", threshold: 0.6, handoffIntent: false, draft }).decision).toBe("sent");
    expect(decide({ mode: "shadow", threshold: 0.6, handoffIntent: false, draft }).decision).toBe("shadow");
  });
  it("hands off on intent, missing citations, low confidence, or the model asking for a human", () => {
    expect(decide({ mode: "live", threshold: 0.6, handoffIntent: true, draft }).decision).toBe("handoff");
    expect(decide({ mode: "live", threshold: 0.6, handoffIntent: false, draft: { ...draft, citations: [] } }).decision).toBe("handoff");
    expect(decide({ mode: "live", threshold: 0.95, handoffIntent: false, draft }).decision).toBe("handoff");
    expect(decide({ mode: "live", threshold: 0.6, handoffIntent: false, draft: { ...draft, needsHuman: true } }).decision).toBe("handoff");
    expect(decide({ mode: "live", threshold: 0.6, handoffIntent: false, draft: null }).decision).toBe("handoff");
  });
  it("detects handoff phrases case-insensitively", () => {
    expect(detectHandoffIntent("Can I TALK TO A HUMAN please", "talk to a human, real person")).toBe(true);
    expect(detectHandoffIntent("What are your hours?", "talk to a human, real person")).toBe(false);
  });
});
