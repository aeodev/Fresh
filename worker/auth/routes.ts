import { router } from "../app";
import { one, run } from "../db";
import { hashPassword, verifyPassword } from "../lib/crypto";
import { badRequest, conflict, isEmail, readJson, str, unauthorized } from "../lib/http";
import { newId } from "../lib/ids";
import { requireUser } from "./middleware";
import { createSession, destroySession } from "./session";

type UserRow = { id: string; email: string; name: string; password_hash: string; created_at: string };

export const authRoutes = router();

authRoutes.post("/signup", async (c) => {
  const body = await readJson<{ email?: unknown; name?: unknown; password?: unknown }>(c);
  const email = str(body.email, 254).toLowerCase();
  const name = str(body.name, 120);
  const password = typeof body.password === "string" ? body.password : "";
  if (!isEmail(email)) throw badRequest("Enter a valid email address.");
  if (name.length < 1) throw badRequest("Enter your name.");
  if (password.length < 8) throw badRequest("Use a password with at least 8 characters.");
  if (await one(c.env.DB, "SELECT id FROM users WHERE email = ?", email)) throw conflict("An account with that email already exists. Sign in instead.");
  const id = newId("usr");
  await run(c.env.DB, "INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)", id, email, name, await hashPassword(password));
  await createSession(c, c.env.DB, id);
  return c.json({ user: { id, email, name, createdAt: new Date().toISOString() } }, 201);
});

authRoutes.post("/login", async (c) => {
  const body = await readJson<{ email?: unknown; password?: unknown }>(c);
  const email = str(body.email, 254).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const row = await one<UserRow>(c.env.DB, "SELECT * FROM users WHERE email = ?", email);
  if (!row || !(await verifyPassword(password, row.password_hash))) throw unauthorized("Email or password is incorrect.");
  await createSession(c, c.env.DB, row.id);
  return c.json({ user: { id: row.id, email: row.email, name: row.name, createdAt: row.created_at } });
});

authRoutes.post("/logout", async (c) => {
  await destroySession(c, c.env.DB);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireUser, (c) => c.json({ user: c.get("user") }));
