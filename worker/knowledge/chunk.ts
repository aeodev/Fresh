// Splits a document into retrieval-sized chunks. Markdown headings start a new section, blank
// lines separate paragraphs, and paragraphs under one heading are packed up to `maxChars`.
// Pure function: the tests in tests/chunk.test.ts pin the behaviour.

export type ChunkInput = { ordinal: number; heading: string; text: string };

export type ChunkOptions = { maxChars?: number; minChars?: number };

function splitLong(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) pieces.push(current);
      current = "";
      for (let i = 0; i < sentence.length; i += maxChars) pieces.push(sentence.slice(i, i + maxChars));
      continue;
    }
    if ((current + " " + sentence).trim().length > maxChars) {
      if (current) pieces.push(current);
      current = sentence;
    } else {
      current = (current ? `${current} ${sentence}` : sentence).trim();
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

export function chunkDocument(title: string, content: string, options: ChunkOptions = {}): ChunkInput[] {
  const maxChars = options.maxChars ?? 1200;
  const minChars = options.minChars ?? 150;
  const cleanTitle = title.trim() || "Document";

  // 1. Blocks: (heading, paragraph) pairs in document order.
  const blocks: Array<{ heading: string; text: string }> = [];
  let heading = cleanTitle;
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) blocks.push({ heading, text });
    buffer = [];
  };
  for (const raw of content.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const md = /^#{1,6}\s+(.+?)\s*#*$/.exec(line.trim());
    if (md) {
      flush();
      heading = `${cleanTitle} › ${md[1].trim()}`;
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    buffer.push(line);
  }
  flush();

  // 2. Pack paragraphs under the same heading up to maxChars.
  const chunks: ChunkInput[] = [];
  let current: { heading: string; parts: string[]; length: number } | null = null;
  const push = () => {
    if (current && current.parts.length) chunks.push({ ordinal: chunks.length, heading: current.heading, text: current.parts.join("\n\n") });
    current = null;
  };
  for (const block of blocks) {
    for (const piece of splitLong(block.text, maxChars)) {
      if (current && (current.heading !== block.heading || current.length + piece.length + 2 > maxChars)) push();
      if (!current) current = { heading: block.heading, parts: [], length: 0 };
      current.parts.push(piece);
      current.length += piece.length + 2;
    }
  }
  push();

  // 3. Fold tiny chunks into their predecessor when the heading matches.
  const merged: ChunkInput[] = [];
  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    if (previous && chunk.text.length < minChars && previous.heading === chunk.heading && previous.text.length + chunk.text.length + 2 <= maxChars * 1.25) {
      previous.text = `${previous.text}\n\n${chunk.text}`;
    } else {
      merged.push({ ...chunk, ordinal: merged.length });
    }
  }
  return merged;
}
