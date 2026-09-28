import { describe, expect, it } from "vitest";
import { findOpenCustomerTurn } from "../worker/agent/turn";

const m = (id: string, actorType: string, text: string, t: number, messageType = "normal") => ({ id, actorType, messageType, text, createdTime: new Date(1700000000000 + t * 1000).toISOString() });

describe("findOpenCustomerTurn", () => {
  it("joins consecutive customer messages after the last reply", () => {
    const turn = findOpenCustomerTurn([m("1", "user", "Hi", 1), m("2", "agent", "Hello!", 2), m("3", "user", "Where is", 3), m("4", "user", "my order?", 4)]);
    expect(turn).toEqual({ messageId: "4", text: "Where is\nmy order?", messageIds: ["3", "4"] });
  });
  it("returns null when the agent spoke last or nothing was said", () => {
    expect(findOpenCustomerTurn([m("1", "user", "Hi", 1), m("2", "agent", "Hello!", 2)])).toBeNull();
    expect(findOpenCustomerTurn([])).toBeNull();
  });
  it("ignores private notes and system messages", () => {
    const turn = findOpenCustomerTurn([m("1", "user", "Hi", 1), m("2", "agent", "note to self", 2, "private"), m("3", "system", "Assigned", 3)]);
    expect(turn?.messageId).toBe("1");
  });
});
