/** Keep customer replies readable in narrow chat bubbles. */
export function formatReply(answer: string): string {
  return answer.trim()
    .replace(/(\d)\s*—\s*(\d)/g, "$1 to $2")
    .replace(/\s*—\s*/g, ", ")
    // Expand suspended compounds: "1-, 3-, or 12-month plan".
    .replace(/\b((?:\d+\s*-\s*,\s*)+(?:(?:or|and)\s+)?\d+)\s*-\s*(month|year|week|day|hour)\b/gi,
      (_match, list: string, unit: string) => `${list.replace(/(\d+)\s*-(?=\s*,)/g, `$1-${unit}`)}-${unit}`)
    .replace(/([^\n])\n(?=\d+[.)]\s)/g, "$1\n\n");
}
