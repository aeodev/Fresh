import { run } from "./db";
import { newId } from "./lib/ids";

/** Append-only activity log. Every decision the agent makes lands here. */
export async function logEvent(
  db: D1Database,
  companyId: string,
  type: string,
  detail: Record<string, unknown> = {},
  conversationId: string | null = null,
) {
  await run(
    db,
    "INSERT INTO events (id, company_id, conversation_id, type, detail_json) VALUES (?, ?, ?, ?, ?)",
    newId("evt"),
    companyId,
    conversationId,
    type,
    JSON.stringify(detail),
  );
}
