import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { User } from "../../shared/types";
import { one, run } from "../db";
import { randomToken, sha256Hex } from "../lib/crypto";

const COOKIE = "fq_session";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(c: Context, db: D1Database, userId: string) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  await run(db, "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", await sha256Hex(token), userId, expiresAt);
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    path: "/",
    maxAge: TTL_MS / 1000,
  });
}

export async function destroySession(c: Context, db: D1Database) {
  const token = getCookie(c, COOKIE);
  if (token) await run(db, "DELETE FROM sessions WHERE id = ?", await sha256Hex(token));
  deleteCookie(c, COOKIE, { path: "/" });
}

type UserRow = { id: string; email: string; name: string; created_at: string };

export async function userFromSession(c: Context, db: D1Database): Promise<User | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const row = await one<UserRow>(
    db,
    `SELECT u.id, u.email, u.name, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
    await sha256Hex(token),
    new Date().toISOString(),
  );
  return row ? { id: row.id, email: row.email, name: row.name, createdAt: row.created_at } : null;
}
