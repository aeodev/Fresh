import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ROLE_DESCRIPTIONS, type Role } from "../../shared/rbac";
import type { Invite, Member } from "../../shared/types";
import { api, timeAgo } from "../api";
import { useCompany } from "../pages/Company";
import { useSession } from "../session";
import { CopyBox } from "./ConnectionSettings";

export function MembersPanel() {
  const { company, allowed } = useCompany();
  const { user } = useSession();
  const base = `/api/companies/${company.slug}`;
  const canManage = allowed("members.manage");
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api<{ members: Member[]; invites: Invite[]; assignableRoles: Role[] }>(`${base}/members`).then((r) => { setMembers(r.members); setInvites(r.invites); setRoles(r.assignableRoles); }).catch((e) => setError(e.message)), [base]);
  useEffect(() => {
    void load();
  }, [load]);

  const wrap = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
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
    });
  };

  return (
    <div className="card">
      <div className="card-header"><div><h2>Members</h2><p className="muted small">Owner: everything. Admin: settings, members, knowledge. Member: knowledge and chats. Viewer: read only.</p></div></div>
      {error && <div className="alert error">{error}</div>}
      <table>
        <thead><tr><th>Person</th><th>Role</th><th>Joined</th><th></th></tr></thead>
        <tbody>
          {members.map((m) => {
            const editable = canManage && m.userId !== user?.id && (m.role !== "owner" || company.role === "owner") && (m.role !== "admin" || company.role === "owner");
            return (
              <tr key={m.userId}>
                <td>{m.name} <span className="muted small">{m.email}</span>{m.userId === user?.id && <span className="muted small"> (you)</span>}</td>
                <td>
                  {editable ? (
                    <select value={m.role} disabled={busy} style={{ width: "auto" }} onChange={(e) => { const next = e.target.value as Role; if (next === "owner" && !confirm(`Make ${m.name} an owner? Owners have full control.`)) return; void wrap(() => api(`${base}/members/${m.userId}`, { method: "PATCH", body: { role: next } })); }}>
                      {(company.role === "owner" ? (["owner", "admin", "member", "viewer"] as Role[]) : roles).map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : <span className="pill">{m.role}</span>}
                </td>
                <td className="muted small">{timeAgo(m.joinedAt)}</td>
                <td className="row end">{editable && m.role !== "owner" && <button className="small danger" disabled={busy} onClick={() => { if (confirm(`Remove ${m.name}?`)) void wrap(() => api(`${base}/members/${m.userId}`, { method: "DELETE" })); }}>Remove</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {canManage && (
        <>
          <form onSubmit={invite} className="row" style={{ marginTop: "1rem", alignItems: "flex-end" }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>Invite by email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" required /></div>
            <div className="field" style={{ marginBottom: 0 }}><label>Role</label><select value={role} onChange={(e) => setRole(e.target.value as Role)} style={{ width: "auto" }}>{roles.filter((r) => r !== "owner").map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
            <button className="primary" disabled={busy}>Send invite</button>
          </form>
          <p className="muted small" style={{ marginTop: 4 }}>{ROLE_DESCRIPTIONS[role]}</p>
          {link && <div className="alert info"><strong>Email is not configured, so send this link yourself:</strong><div style={{ marginTop: 6 }}><CopyBox value={link} /></div></div>}
          {invites.length > 0 && (
            <>
              <h3 style={{ marginTop: "1rem" }}>Pending invites</h3>
              <table>
                <tbody>
                  {invites.map((i) => (
                    <tr key={i.id}><td>{i.email}</td><td><span className="pill">{i.role}</span></td><td className="muted small">sent {timeAgo(i.createdAt)}</td>
                      <td className="row end"><button className="small danger" disabled={busy} onClick={() => void wrap(() => api(`${base}/invites/${i.id}`, { method: "DELETE" }))}>Cancel</button></td></tr>
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
