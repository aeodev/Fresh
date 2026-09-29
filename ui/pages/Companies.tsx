import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import type { CompanySummary } from "../../shared/types";
import { api } from "../api";
import { Alert, Avatar, Chip, EmptyState, Icon, Skeleton, greeting } from "../components/ui";
import { useSession } from "../session";

export function modeLabel(mode: CompanySummary["mode"]) {
  return mode === "off" ? "Agent off" : mode === "shadow" ? "Shadow mode" : "Live";
}

export function Companies() {
  const { user, logout } = useSession();
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<CompanySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ companies: CompanySummary[] }>("/api/companies").then((r) => setCompanies(r.companies)).catch((e) => setError(e.message));
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ company: CompanySummary }>("/api/companies", { body: { name } });
      navigate(`/c/${result.company.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the company.");
    } finally {
      setBusy(false);
    }
  };

  const showForm = creating || (companies !== null && companies.length === 0);

  return (
    <div className="main page" style={{ margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: "0.9rem" }}>
          {user && <Avatar name={user.name} size="lg" />}
          <div>
            <div className="eyebrow">Your workspace</div>
            <h1>{user ? greeting(user.name) : "Companies"}</h1>
            <p>Each company has its own Freshchat, its own knowledge, and its own agent.</p>
          </div>
        </div>
        <div className="row">
          {!showForm && <button className="primary" onClick={() => setCreating(true)}><Icon name="plus" /> New company</button>}
          <button className="ghost" onClick={() => void logout()}><Icon name="logout" /> Sign out</button>
        </div>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {companies === null ? (
        <div className="grid-3"><div className="card"><Skeleton /></div><div className="card"><Skeleton /></div></div>
      ) : (
        <div className="grid-3">
          {companies.map((c) => (
            <Link key={c.id} to={`/c/${c.slug}`} className="card" style={{ color: "inherit", display: "block" }}>
              <div className="row between" style={{ marginBottom: "0.9rem" }}>
                <Avatar name={c.name} size="lg" />
                <Chip tone={c.mode} dot>{modeLabel(c.mode)}</Chip>
              </div>
              <h2 style={{ marginBottom: "0.2rem" }}>{c.name}</h2>
              <div className="muted small">You are {c.role}</div>
              <div className="row" style={{ marginTop: "1rem", color: "var(--brand-600)", fontWeight: 700, fontSize: "0.85rem" }}>Open <Icon name="arrowRight" size={15} /></div>
            </Link>
          ))}
          {showForm ? (
            <form className="card" onSubmit={create} style={{ borderStyle: "dashed" }}>
              <div className="row" style={{ marginBottom: "0.6rem" }}><span className="tile-ico tone-brand" style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center" }}><Icon name="building" /></span><h2>New company</h2></div>
              <p className="muted small" style={{ marginBottom: "0.9rem" }}>One brand, one Freshchat account, one agent. You become the owner and can invite your team.</p>
              <div className="field"><label>Company name</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Support" required minLength={2} autoFocus /></div>
              <div className="row">
                <button className="primary" disabled={busy}>{busy ? "Creating…" : "Create company"}</button>
                {companies.length > 0 && <button type="button" className="ghost" onClick={() => setCreating(false)}>Cancel</button>}
              </div>
            </form>
          ) : null}
        </div>
      )}
      {companies && companies.length === 0 && !showForm && (
        <EmptyState icon="building" title="No companies yet">Create one, or ask a teammate for an invite link.</EmptyState>
      )}
    </div>
  );
}
