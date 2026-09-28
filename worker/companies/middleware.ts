import { createMiddleware } from "hono/factory";
import { can, type Permission } from "../../shared/rbac";
import type { AppEnv } from "../app";
import { forbidden, notFound } from "../lib/http";
import { getCompanyBySlug, getRole } from "./repo";

/** Loads the company from `:slug`, checks the caller's role has `permission`, and exposes both on the context. */
export const withCompany = (permission: Permission) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const company = await getCompanyBySlug(c.env.DB, c.req.param("slug") ?? "");
    if (!company) throw notFound("Company not found.");
    const role = await getRole(c.env.DB, company.id, c.get("user").id);
    if (!role) throw notFound("Company not found.");
    if (!can(role, permission)) throw forbidden();
    c.set("company", company);
    c.set("role", role);
    await next();
  });
