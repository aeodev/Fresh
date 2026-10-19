// Hybrid retrieval: cosine similarity on embeddings blended with keyword overlap.
// Pure and synchronous, so it is unit tested without any service.

export type ChunkForRetrieval = { id: string; docId: string; ordinal?: number; heading: string; text: string; embedding: Float32Array | null };
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
    const compatible = Boolean(queryVector && chunk.embedding && queryVector.length === chunk.embedding.length);
    const vec = compatible ? cosine(queryVector!, chunk.embedding!) : 0;
    const score = compatible ? 0.65 * vec + 0.35 * kw : kw;
    return { ...chunk, score, vectorScore: vec, keywordScore: kw, floor: compatible ? 0.2 : 0.01 };
  });
  return ranked
    .filter((c) => c.score > c.floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Keep the paragraph before and after the strongest matches; FAQ answers often cross chunk boundaries. */
export function includeAdjacentChunks(ranked: RankedChunk[], allChunks: ChunkForRetrieval[], maxTotal = 10): RankedChunk[] {
  const selected: RankedChunk[] = [];
  const seen = new Set<string>();
  const rankedById = new Map(ranked.map((chunk) => [chunk.id, chunk]));
  const byPosition = new Map(allChunks.filter((chunk) => chunk.ordinal !== undefined).map((chunk) => [`${chunk.docId}:${chunk.ordinal}`, chunk]));
  const add = (chunk: RankedChunk) => {
    if (seen.has(chunk.id) || selected.length >= maxTotal) return;
    selected.push(chunk);
    seen.add(chunk.id);
  };
  for (const [index, match] of ranked.entries()) {
    if (index < 2 && match.ordinal !== undefined) {
      for (const ordinal of [match.ordinal - 1, match.ordinal]) {
        const chunk = byPosition.get(`${match.docId}:${ordinal}`);
        if (chunk) add(rankedById.get(chunk.id) ?? { ...chunk, score: match.score * 0.5, vectorScore: 0, keywordScore: 0 });
      }
      const next = byPosition.get(`${match.docId}:${match.ordinal + 1}`);
      if (next) add(rankedById.get(next.id) ?? { ...next, score: match.score * 0.5, vectorScore: 0, keywordScore: 0 });
    } else {
      add(match);
    }
  }
  return selected;
}
