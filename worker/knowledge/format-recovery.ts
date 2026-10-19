import { diffArrays } from "diff";
import { hasSameText } from "../../shared/knowledge-format";

function separateWhitespace(text: string) {
  const chars: string[] = [];
  const gaps = [""];
  for (const char of text) {
    if (/\s/u.test(char)) gaps[chars.length] += char;
    else {
      chars.push(char);
      gaps.push("");
    }
  }
  return { chars, gaps };
}

/** Project model-chosen spacing onto original characters after a small AI transcription error. */
export function recoverFormatting(original: string, suggestion: string): string | null {
  const source = separateWhitespace(original);
  const proposed = separateWhitespace(suggestion);
  const changes = diffArrays(source.chars, proposed.chars, { maxEditLength: 128, timeout: 500 });
  if (!changes) return null;

  const gaps = [...source.gaps];
  let sourceIndex = 0;
  let proposedIndex = 0;
  for (const change of changes) {
    if (change.removed) sourceIndex += change.value.length;
    else if (change.added) proposedIndex += change.value.length;
    else {
      for (const char of change.value) {
        if (source.chars[sourceIndex] !== char || proposed.chars[proposedIndex] !== char) return null;
        gaps[sourceIndex] = proposed.gaps[proposedIndex];
        sourceIndex += 1;
        proposedIndex += 1;
      }
    }
  }
  if (sourceIndex !== source.chars.length || proposedIndex !== proposed.chars.length) return null;
  gaps[source.chars.length] = proposed.gaps[proposed.chars.length];
  const recovered = source.chars.map((char, index) => `${gaps[index]}${char}`).join("") + gaps[source.chars.length];
  return hasSameText(original, recovered) ? recovered : null;
}
