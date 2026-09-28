import type { Env } from "../env";

export const EMBEDDING_DIMENSIONS = 512;
const DEFAULT_MODEL = "text-embedding-3-small";

export function vectorToBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function blobToVector(blob: ArrayBuffer | Uint8Array | number[] | null | undefined): Float32Array | null {
  if (!blob) return null;
  if (Array.isArray(blob)) return new Float32Array(blob);
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  if (bytes.byteLength % 4 !== 0) return null;
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/** Embeds texts with OpenAI. Returns null when no key is configured so callers can fall back to keyword search. */
export async function embedTexts(env: Env, texts: string[]): Promise<Float32Array[] | null> {
  if (!env.OPENAI_API_KEY || !texts.length) return null;
  const model = env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_MODEL;
  const output: Float32Array[] = [];
  for (let start = 0; start < texts.length; start += 64) {
    const batch = texts.slice(start, start + 64).map((t) => t.slice(0, 8000));
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ model, input: batch, ...(model.startsWith("text-embedding-3") ? { dimensions: EMBEDDING_DIMENSIONS } : {}) }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`OpenAI embeddings failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    const data = (await response.json()) as { data?: Array<{ index: number; embedding: number[] }> };
    const rows = [...(data.data ?? [])].sort((a, b) => a.index - b.index);
    if (rows.length !== batch.length) throw new Error("OpenAI returned the wrong number of embeddings.");
    for (const row of rows) output.push(new Float32Array(row.embedding));
  }
  return output;
}
