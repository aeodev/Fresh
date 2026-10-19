const emoji: Record<string, string> = {
  wave: "👋", speech_balloon: "💬", sparkles: "✨", handshake: "🤝", blush: "😊", rocket: "🚀",
  smile: "😄", grinning: "😀", heart: "❤️", thumbs_up: "👍", thumbsup: "👍", check: "✅",
  white_check_mark: "✅", warning: "⚠️", tada: "🎉", thinking: "🤔", wink: "😉", cry: "😢",
};

/** Convert Freshchat rich text to displayable plain text. React renders the result as text. */
export function cleanFreshchatText(input: string): string {
  let text = input;
  if (/<\/?[a-z][^>]*>/i.test(text)) {
    text = text
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<\/(p|div|li|ul|ol|section|h[1-6])\s*>/gi, "\n\n")
      .replace(/<\/?(?:strong|b)\b[^>]*>/gi, "**")
      .replace(/<[^>]*>/g, "");
  }
  text = text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    if (!entity.startsWith("#")) return named[entity.toLowerCase()] ?? match;
    const number = entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : match;
  });
  return text
    .replace(/:([a-z0-9_+-]+):/gi, (match, name: string) => emoji[name.toLowerCase()] ?? match)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
