import type { FreshchatConnection } from "../../shared/types";
import { one, run } from "../db";
import type { Env } from "../env";
import { decryptSecret, maskSecret } from "../lib/crypto";
import { FreshchatClient } from "./client";

export type ConnectionRow = {
  company_id: string;
  api_base_url: string;
  api_key_enc: string;
  app_id: string | null;
  reply_agent_id: string | null;
  reply_agent_name: string | null;
  webhook_secret: string;
  webhook_public_key: string | null;
  verified_at: string | null;
  last_error: string | null;
  updated_at: string;
};

export async function getConnection(db: D1Database, companyId: string) {
  return one<ConnectionRow>(db, "SELECT * FROM freshchat_connections WHERE company_id = ?", companyId);
}

export async function clientFor(env: Env, row: ConnectionRow) {
  return new FreshchatClient(row.api_base_url, await decryptSecret(row.api_key_enc, env.ENCRYPTION_KEY));
}

export async function toPublic(env: Env, row: ConnectionRow, baseUrl: string): Promise<FreshchatConnection> {
  return {
    apiBaseUrl: row.api_base_url,
    apiKeyMasked: maskSecret(await decryptSecret(row.api_key_enc, env.ENCRYPTION_KEY)),
    appId: row.app_id,
    replyAgentId: row.reply_agent_id,
    replyAgentName: row.reply_agent_name,
    webhookUrl: `${baseUrl}/api/ingest/freshchat/${row.company_id}/${row.webhook_secret}`,
    webhookPublicKeySet: Boolean(row.webhook_public_key),
    verifiedAt: row.verified_at,
    lastError: row.last_error,
  };
}

export async function recordConnectionError(db: D1Database, companyId: string, message: string) {
  await run(db, "UPDATE freshchat_connections SET last_error = ?, updated_at = ? WHERE company_id = ?", message.slice(0, 500), new Date().toISOString(), companyId);
}
