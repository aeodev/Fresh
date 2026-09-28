// Public endpoint for the account-level Freshchat webhook:  POST /api/ingest/freshchat/:companyId/:secret
// The secret in the path authenticates the call; the RSA signature is checked too when a public key is saved.

import { router } from "../app";
import { ingestEvent } from "../conversations/ingest";
import { logEvent } from "../events";
import { constantTimeEqual } from "../lib/crypto";
import { getConnection } from "./connection";
import { normalizeFreshchatEvent } from "./events";
import { verifyFreshchatSignature } from "./signature";

export const ingestRoutes = router();

ingestRoutes.post("/freshchat/:companyId/:secret", async (c) => {
  const companyId = c.req.param("companyId");
  const connection = await getConnection(c.env.DB, companyId);
  if (!connection || !constantTimeEqual(connection.webhook_secret, c.req.param("secret"))) return c.json({ error: "Unknown webhook." }, 404);

  const raw = await c.req.text();
  if (connection.webhook_public_key) {
    const signature = c.req.header("x-freshchat-signature") ?? "";
    if (!signature || !(await verifyFreshchatSignature(connection.webhook_public_key, raw, signature))) {
      await logEvent(c.env.DB, companyId, "ingest_rejected", { reason: "bad signature" });
      return c.json({ error: "Signature check failed." }, 401);
    }
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.json({ error: "Body is not JSON." }, 400);
  }
  const event = normalizeFreshchatEvent(payload);
  // Answer within Freshchat's timeout; the actual work continues in the Durable Object.
  c.executionCtx.waitUntil(ingestEvent(c.env, companyId, connection, event, "webhook").catch((error) => logEvent(c.env.DB, companyId, "ingest_error", { error: String(error) }, event.conversationId)));
  return c.json({ ok: true, kind: event.kind, conversationId: event.conversationId }, 202);
});
