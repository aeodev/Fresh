import { expect, it } from "vitest";
import { retrievalQuery } from "../worker/agent/context";
import { unprocessedCustomerMessages } from "../worker/agent/turn";

it("keeps device and previous instruction in searches for guided follow-ups", () => {
  const history = [{ role: "customer" as const, text: "How do I install on Firestick?" }, { role: "agent" as const, text: "Open the app store. Can you see it?" }];
  for (const reply of ["Done", "Yes", "I don't see it", "I'm confused", "Can you walk me through it?", "wait sorry i dont get it, explain simply", "sorry whats the perks of each plan"]) {
    expect(retrievalQuery(reply, history)).toContain("Firestick");
    expect(retrievalQuery(reply, history)).toContain("Open the app store");
  }
  expect(retrievalQuery("What plans do you offer here?", history)).toBe("What plans do you offer here?");
});

it("consumes held turns without joining them into later questions, retaining new bursts", () => {
  const message = (id: string) => ({ id, actorType: "user", messageType: "normal", text: id, createdTime: id });
  expect(unprocessedCustomerMessages([message("3"), message("1"), message("2")], ["1", "2", "3"], new Set(["1"])).map(m => m.id)).toEqual(["2", "3"]);
  expect(unprocessedCustomerMessages([message("1")], ["1"], new Set(["1"]))).toEqual([]);
});
