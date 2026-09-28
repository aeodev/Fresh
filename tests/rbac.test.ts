import { describe, expect, it } from "vitest";
import { assignableRoles, can, isRole } from "../shared/rbac";

describe("rbac", () => {
  it("owner can do everything, viewer only reads", () => {
    expect(can("owner", "company.delete")).toBe(true);
    expect(can("admin", "company.delete")).toBe(false);
    expect(can("viewer", "knowledge.read")).toBe(true);
    expect(can("viewer", "knowledge.write")).toBe(false);
    expect(can(null, "company.read")).toBe(false);
  });
  it("member can edit knowledge and take over chats but not manage members", () => {
    expect(can("member", "knowledge.write")).toBe(true);
    expect(can("member", "conversations.takeover")).toBe(true);
    expect(can("member", "members.manage")).toBe(false);
    expect(can("member", "agent.mode")).toBe(false);
  });
  it("only owners can hand out ownership", () => {
    expect(assignableRoles("owner")).toContain("owner");
    expect(assignableRoles("admin")).not.toContain("owner");
    expect(assignableRoles("member")).toEqual([]);
    expect(isRole("admin")).toBe(true);
    expect(isRole("god")).toBe(false);
  });
});
