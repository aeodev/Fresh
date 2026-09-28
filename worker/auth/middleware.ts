import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app";
import { unauthorized } from "../lib/http";
import { userFromSession } from "./session";

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await userFromSession(c, c.env.DB);
  if (!user) throw unauthorized();
  c.set("user", user);
  await next();
});
