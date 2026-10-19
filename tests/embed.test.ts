import { describe, expect, it } from "vitest";
import { blobToVector, vectorToBlob } from "../worker/knowledge/embed";
import { rankChunks } from "../worker/knowledge/retrieve";

describe("D1 embedding decoding", () => {
  it("round-trips 512 float32 components through D1's JSON byte array and retrieves plans", () => {
    const vector = new Float32Array(512).fill(0.125);
    const bytes = vectorToBlob(vector);
    for (const blob of [Array.from(bytes), bytes, bytes.buffer as ArrayBuffer]) {
      const decoded = blobToVector(blob)!;
      expect(decoded).toEqual(vector);
      expect(decoded.length).toBe(512);
      expect(rankChunks("What plans do you offer here?", vector, [{ id: "plans", docId: "d", heading: "Apollo", text: "Four subscription plans are available.", embedding: decoded }])[0]?.id).toBe("plans");
    }
  });
  it("handles a byte view with an offset and rejects malformed bytes", () => {
    const bytes = vectorToBlob(new Float32Array([0.1, -0.25]));
    const padded = new Uint8Array(bytes.length + 4);
    padded.set(bytes, 2);
    expect(blobToVector(padded.subarray(2, 2 + bytes.length))).toEqual(new Float32Array([0.1, -0.25]));
    for (const blob of [[], [1, 2, 3], [256, 0, 0, 0], [0.5, 0, 0, 0]]) expect(blobToVector(blob)).toBeNull();
  });
  it("uses keywords when query and stored dimensions differ instead of filtering everything out", () => {
    const ranked = rankChunks("What plans do you offer here?", new Float32Array(512), [{ id: "plans", docId: "d", heading: "Apollo", text: "Four subscription plans are available.", embedding: new Float32Array(2048) }]);
    expect(ranked[0]?.id).toBe("plans");
  });
});
