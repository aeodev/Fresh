/** Only standalone greetings qualify. A greeting followed by a question still needs knowledge. */
export function greetingReply(question: string): string | null {
  const text = question.trim().toLowerCase().replace(/[!?.،,]+$/u, "").trim();
  if (/^(?:sup|yo|heya)$/.test(text)) return "Hey! What can I help you with?";
  if (/^(?:hi|hello|hey|hiya|good morning|good afternoon|good evening)(?: there)?$/.test(text)) {
    return "Hello! How can I help you today?";
  }
  if (/^(?:kumusta|kamusta)(?: po)?$/.test(text)) {
    return "Kumusta! Paano kita matutulungan ngayon?";
  }
  return null;
}


/** A short, truthful product identity answer that needs no knowledge lookup. */
export function supportIdentityReply(question: string, companyName: string, selectedAgentName?: string | null): string | null {
  const text = question.trim().toLowerCase()
    .replace(/\bhgi\b/g, "hi")
    .replace(/\baiu\b/g, "ai")
    .replace(/\bwhats\b/g, "what is")
    .replace(/\b(u|ur)\b/g, (_match, word: string) => word === "ur" ? "your" : "you")
    .replace(/[?!.,]+/gu, " ").replace(/\s+/g, " ").trim()
    .replace(/^(?:hi|hey|hello) +/, "");
  const asksAge = /^(?:how old are you|what is your age|what age are you)$/.test(text);
  if (asksAge) return "I’d rather not share that. What can I help you with?";
  const asksIdentity = /^(?:who are you|what are you|are you (?:(?:a|an) )?(?:ai|artificial intelligence|bot|human)|are you (?:a )?(?:real )?person|is this (?:an? )?(?:ai|bot)|what is your name|what is the name)$/.test(text);
  if (!asksIdentity) return null;
  const agent = selectedAgentName?.trim();
  const firstName = agent?.split(/\s+/)[0];
  if (/^(?:what is your name|what is the name)$/.test(text)) {
    return firstName ? `I’m ${firstName}. What can I help with?` : `I’m with ${companyName} Support. What can I help with?`;
  }
  return firstName
    ? `${firstName} here with ${companyName} Support. What do you need a hand with?`
    : `I’m with ${companyName} Support. What do you need a hand with?`;
}
