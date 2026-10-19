// Which customer messages need an answer right now.

export type TurnMessage = { id: string; actorType: string; messageType: string; text: string; createdTime: string };

export function unprocessedCustomerMessages<T extends TurnMessage>(messages: T[], pendingIds: string[], processedIds: Set<string>): T[] {
  const pending = new Set(pendingIds);
  const ordered = messages.filter(message => pending.has(message.id)).sort((a, b) => a.createdTime.localeCompare(b.createdTime));
  let lastProcessed = -1;
  for (let index = 0; index < ordered.length; index += 1) {
    if (processedIds.has(ordered[index].id)) lastProcessed = index;
  }
  return ordered.slice(lastProcessed + 1);
}

/**
 * Every consecutive customer message after the last agent or bot reply, joined into one question.
 * Private notes and system messages are ignored. Returns null when the last word was ours.
 */
export function findOpenCustomerTurn(messages: TurnMessage[]): { messageId: string; text: string; messageIds: string[] } | null {
  const visible = messages
    .filter((m) => m.messageType === "normal" && m.text.trim())
    .sort((a, b) => a.createdTime.localeCompare(b.createdTime));
  let lastReply = -1;
  for (let i = visible.length - 1; i >= 0; i -= 1) {
    if (visible[i].actorType === "agent" || visible[i].actorType === "bot") {
      lastReply = i;
      break;
    }
  }
  const open = visible.slice(lastReply + 1).filter((m) => m.actorType === "user");
  if (!open.length) return null;
  return { messageId: open[open.length - 1].id, text: open.map((m) => m.text.trim()).join("\n").slice(0, 4000), messageIds: open.map((m) => m.id) };
}
