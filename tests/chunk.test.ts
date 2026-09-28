import { describe, expect, it } from "vitest";
import { chunkDocument } from "../worker/knowledge/chunk";

describe("chunkDocument", () => {
  it("keeps headings with their paragraphs", () => {
    const chunks = chunkDocument("Shipping", "# Delivery times\n\nOrders ship in 2 days.\n\n# Returns\n\nYou have 30 days to return an item.");
    expect(chunks.map((c) => c.heading)).toEqual(["Shipping › Delivery times", "Shipping › Returns"]);
    expect(chunks[1].text).toContain("30 days");
  });
  it("packs short paragraphs under one heading and splits long ones", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} explains a detail of the policy.`).join(" ");
    const chunks = chunkDocument("Policy", `Short one.\n\nShort two.\n\n${long}`, { maxChars: 400, minChars: 50 });
    expect(chunks[0].text).toContain("Short one.");
    expect(chunks[0].text).toContain("Short two.");
    expect(chunks.every((c) => c.text.length <= 500)).toBe(true);
    expect(chunks.length).toBeGreaterThan(3);
  });
  it("returns nothing for empty input", () => {
    expect(chunkDocument("Empty", "   \n\n  ")).toEqual([]);
  });
});
