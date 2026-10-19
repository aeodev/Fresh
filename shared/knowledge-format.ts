/** Only whitespace may change; every original letter, number, and symbol stays in order. */
export function hasSameText(original: string, candidate: string): boolean {
  return original.replace(/\s/gu, "") === candidate.replace(/\s/gu, "");
}

/** Keep large requests under the formatter's per-request limit without changing the text. */
export function splitForFormatting(text: string, maxChars = 6_000): string[] {
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const earliest = start + Math.floor(maxChars / 2);
      for (const separator of ["\n\n", "\n", ". ", " "]) {
        const boundary = text.lastIndexOf(separator, end);
        if (boundary > earliest) {
          end = boundary + separator.length;
          break;
        }
      }
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}
