import { Hono } from "hono";
import type { Role } from "../shared/rbac";
import type { User } from "../shared/types";
import type { Env } from "./env";

export type CompanyRow = { id: string; slug: string; name: string; created_by: string; created_at: string };

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: User;
    company: CompanyRow;
    role: Role;
    sidebarCompany: CompanyRow;
  };
};

export const router = () => new Hono<AppEnv>();
