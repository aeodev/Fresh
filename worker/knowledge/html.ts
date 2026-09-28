/** Good-enough HTML to text for importing a help page. Keeps headings as markdown so chunking sees sections. */
export function htmlToText(html: string) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const main = /<main[\s\S]*?<\/main>/i.exec(text) ?? /<article[\s\S]*?<\/article>/i.exec(text);
  if (main) text = main[0];
  text = text
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => `\n\n${"#".repeat(Number(level))} ${inner.replace(/<[^>]+>/g, " ").trim()}\n\n`)
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/section)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)));
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function titleFromHtml(html: string, fallback: string) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? match[1].replace(/\s+/g, " ").trim().slice(0, 120) || fallback : fallback;
}
