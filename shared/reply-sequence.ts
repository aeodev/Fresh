/** Split a complete answer into chat-sized messages without rewriting its words. */
export function splitReply(answer: string, targetChars = 420): string[] {
  const text = answer.trim();
  if (!text) return [];
  if (text.length <= targetChars) return [text];

  const boundaries: number[] = [];
  const naturalBreak = /\n+|(?<!\d\.)(?<=[.!?])\s+(?=[A-Z0-9“"(])/gu;
  for (const match of text.matchAll(naturalBreak)) boundaries.push(match.index + match[0].length);
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    if (text.length - start <= targetChars) {
      parts.push(text.slice(start).trim());
      break;
    }
    const desired = start + targetChars;
    let end = boundaries.filter((position) => position > start + targetChars * 0.45 && position <= desired).at(-1);
    if (!end) {
      const space = text.lastIndexOf(" ", desired);
      end = space > start ? space + 1 : desired;
    }
    // Keep **bold phrases** intact so neither chat bubble exposes half a marker.
    if (((text.slice(start, end).match(/\*\*/g) ?? []).length % 2) === 1) {
      const opening = text.lastIndexOf("**", end - 1);
      const closing = text.indexOf("**", end);
      if (opening > start) end = opening;
      else if (closing >= 0 && closing + 2 - start < 4000) end = closing + 2;
    }
    const pendingStep = text.slice(start, end).match(/(?:^|\s)(\d+[.)])\s*$/u);
    if (pendingStep) {
      const markerStart = text.lastIndexOf(pendingStep[1], end - 1);
      if (markerStart > start) end = markerStart;
    }
    parts.push(text.slice(start, end).trim());
    start = end;
  }
  return parts.filter(Boolean);
}

/** Pause before each later bubble according to how much text is about to arrive. */
export function nextReplyDelayMs(nextMessage: string): number {
  return Math.min(8_000, Math.max(900, Math.round(500 + nextMessage.length * 24)));
}
