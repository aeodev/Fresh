import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app";
import { getCompanyById } from "../companies/repo";
import { one, run } from "../db";
import { sha256Hex } from "../lib/crypto";
import { unauthorized } from "../lib/http";

/** The Freshchat sidebar app authenticates with its install token: `Authorization: Bearer <token>`. */
export const requireSidebarToken = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? "";
  if (!token) throw unauthorized("Missing FreshQA token. Paste the Companion token in the app's install settings.");
  const hash = await sha256Hex(token);
  const row = await one<{ company_id: string }>(c.env.DB, "SELECT company_id FROM sidebar_tokens WHERE token_hash = ? AND revoked_at IS NULL", hash);
  const company = row ? await getCompanyById(c.env.DB, row.company_id) : null;
  if (!company) throw unauthorized("This FreshQA token is not valid. Issue a new one from Settings → Freshchat sidebar.");
  c.executionCtx.waitUntil(run(c.env.DB, "UPDATE sidebar_tokens SET last_used_at = ? WHERE token_hash = ?", new Date().toISOString(), hash));
  c.set("sidebarCompany", company);
  await next();
});
