import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ROLE_DESCRIPTIONS, type Role } from "../../shared/rbac";
import type { Invite, Member } from "../../shared/types";
import { api, timeAgo } from "../api";
import { useCompany } from "../pages/Company";
import { useSession } from "../session";
import { CopyBox } from "./ConnectionSettings";
import { Alert, Avatar, Chip, Icon, useToast } from "./ui";

export function MembersPanel() {
  const { company, allowed } = useCompany();
  const { user } = useSession();
  const toast = useToast();
  const base = `/api/companies/${company.slug}`;
  const canManage = allowed("members.manage");
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<{ members: Member[]; invites: Invite[]; assignableRoles: Role[] }>(`${base}/members`).then((r) => { setMembers(r.members); setInvites(r.invites); setRoles(r.assignableRoles); }).catch((e) => toast.error(e.message)), [base, toast]);
  useEffect(() => {
    void load();
  }, [load]);

  const wrap = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      await load();
      if (done) toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const invite = (e: FormEvent) => {
    e.preventDefault();
    void wrap(async () => {
      const r = await api<{ invite: Invite; emailed: boolean }>(`${base}/invites`, { body: { email, role } });
      setLink(r.emailed ? null : r.invite.acceptUrl ?? null);
      setEmail("");
    }, "Invite created.");
  };

  return (
    <div className="card">
      <div className="card-header">
        <div className="row" style={{ gap: "0.8rem" }}>
          <span className="tile-ico tone-sky" style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center" }}><Icon name="users" /></span>
          <div><h2>Members</h2><p>Owner: everything. Admin: settings, members, knowledge. Member: knowledge and chats. Viewer: read only.</p></div>
        </div>
      </div>
      <table>
        <thead><tr><th style={{ width: 44 }}></th><th>Person</th><th>Role</th><th>Joined</th><th></th></tr></thead>
        <tbody>
          {members.map((m) => {
            const editable = canManage && m.userId !== user?.id && (m.role !== "owner" || company.role === "owner") && (m.role !== "admin" || company.role === "owner");
            return (
              <tr key={m.userId}>
                <td><Avatar name={m.name} /></td>
                <td><strong>{m.name}</strong>{m.userId === user?.id && <span className="muted small"> (you)</span>}<div className="muted tiny">{m.email}</div></td>
                <td>
                  {editable ? (
                    <select value={m.role} disabled={busy} style={{ width: "auto" }} onChange={(e) => { const next = e.target.value as Role; if (next === "owner" && !confirm(`Make ${m.name} an owner? Owners have full control.`)) return; void wrap(() => api(`${base}/members/${m.userId}`, { method: "PATCH", body: { role: next } }), "Role updated."); }}>
                      {(company.role === "owner" ? (["owner", "admin", "member", "viewer"] as Role[]) : roles).map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : <Chip tone={m.role === "owner" ? "info" : ""}>{m.role}</Chip>}
                </td>
                <td className="muted small">{timeAgo(m.joinedAt)}</td>
                <td className="row end">{editable && m.role !== "owner" && <button className="small ghost" disabled={busy} onClick={() => { if (confirm(`Remove ${m.name}?`)) void wrap(() => api(`${base}/members/${m.userId}`, { method: "DELETE" }), "Member removed."); }}><Icon name="trash" /></button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {canManage && (
        <>
          <form onSubmit={invite} className="row" style={{ marginTop: "1rem", alignItems: "flex-end" }}>
            <div className="field grow" style={{ marginBottom: 0 }}><label>Invite by email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" required /></div>
            <div className="field" style={{ marginBottom: 0 }}><label>Role</label><select value={role} onChange={(e) => setRole(e.target.value as Role)} style={{ width: "auto" }}>{roles.filter((r) => r !== "owner").map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
            <button className="primary" disabled={busy}><Icon name="mail" /> Send invite</button>
          </form>
          <p className="muted tiny" style={{ marginTop: 6 }}>{ROLE_DESCRIPTIONS[role]}</p>
          {link && <div style={{ marginTop: "0.8rem" }}><Alert tone="info"><strong>Email is not configured, so send this link yourself:</strong><div style={{ marginTop: 6 }}><CopyBox value={link} /></div></Alert></div>}
          {invites.length > 0 && (
            <>
              <h3 style={{ margin: "1rem 0 0.4rem" }}>Pending invites</h3>
              <table>
                <tbody>
                  {invites.map((i) => (
                    <tr key={i.id}><td>{i.email}</td><td><Chip>{i.role}</Chip></td><td className="muted small">sent {timeAgo(i.createdAt)}</td>
                      <td className="row end"><button className="small ghost" disabled={busy} onClick={() => void wrap(() => api(`${base}/invites/${i.id}`, { method: "DELETE" }), "Invite cancelled.")}><Icon name="x" /> Cancel</button></td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}
