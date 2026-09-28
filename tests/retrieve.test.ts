import { describe, expect, it } from "vitest";
import { cosine, keywordScore, rankChunks } from "../worker/knowledge/retrieve";

const chunk = (id: string, text: string, embedding: number[] | null = null) => ({ id, docId: "d", heading: "H", text, embedding: embedding ? new Float32Array(embedding) : null });

describe("retrieval", () => {
  it("keyword score rewards term overlap and exact phrases", () => {
    expect(keywordScore("refund policy", "Our refund policy lasts 30 days")).toBeGreaterThan(0.9);
    expect(keywordScore("refund policy", "Shipping takes two days")).toBe(0);
  });
  it("cosine is 1 for identical vectors and 0 for orthogonal ones", () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBeCloseTo(1);
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0);
  });
  it("ranks by keywords when no embeddings exist", () => {
    const ranked = rankChunks("how do I reset my password", null, [chunk("a", "Shipping is free over $50"), chunk("b", "To reset your password open Settings and choose Reset password")]);
    expect(ranked[0].id).toBe("b");
    expect(ranked.find((c) => c.id === "a")).toBeUndefined();
  });
  it("blends vector similarity with keywords", () => {
    const ranked = rankChunks("password", new Float32Array([1, 0]), [chunk("near", "unrelated words", [0.9, 0.1]), chunk("far", "password reset steps", [0, 1])], 2);
    expect(ranked.map((c) => c.id)).toContain("far");
    expect(ranked[0].score).toBeGreaterThan(0.2);
  });
});
