// Hybrid retrieval: cosine similarity on embeddings blended with keyword overlap.
// Pure and synchronous, so it is unit tested without any service.

export type ChunkForRetrieval = { id: string; docId: string; heading: string; text: string; embedding: Float32Array | null };
export type RankedChunk = ChunkForRetrieval & { score: number; vectorScore: number; keywordScore: number };

const STOP = new Set(
  "a an and are as at be but by for from has have how i if in into is it its of on or that the this to was what when where which who why will with you your can do does my me we our us please hi hello thanks".split(" "),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

export function keywordScore(query: string, text: string): number {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return 0;
  const haystack = new Set(tokenize(text));
  let hits = 0;
  for (const term of terms) if (haystack.has(term)) hits += 1;
  let score = hits / terms.length;
  const phrase = query.trim().toLowerCase();
  if (phrase.length >= 8 && text.toLowerCase().includes(phrase)) score = Math.min(1, score + 0.25);
  return score;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export function rankChunks(query: string, queryVector: Float32Array | null, chunks: ChunkForRetrieval[], topK = 6): RankedChunk[] {
  const ranked = chunks.map((chunk) => {
    const kw = keywordScore(query, `${chunk.heading}\n${chunk.text}`);
    const vec = queryVector && chunk.embedding ? cosine(queryVector, chunk.embedding) : 0;
    const score = queryVector && chunk.embedding ? 0.65 * vec + 0.35 * kw : kw;
    return { ...chunk, score, vectorScore: vec, keywordScore: kw };
  });
  const floor = queryVector ? 0.2 : 0.01;
  return ranked
    .filter((c) => c.score > floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
