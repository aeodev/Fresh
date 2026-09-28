import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import type { CompanySummary } from "../../shared/types";
import { api } from "../api";
import { useSession } from "../session";

export function Companies() {
  const { user, logout } = useSession();
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<CompanySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
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

  return (
    <div className="main" style={{ margin: "0 auto" }}>
      <div className="topbar">
        <div className="title"><h1>Your companies</h1></div>
        <div className="row">
          <span className="muted small">{user?.email}</span>
          <button className="small" onClick={() => void logout()}>Sign out</button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="grid-2">
        {companies?.map((c) => (
          <Link key={c.id} to={`/c/${c.slug}`} className="card" style={{ color: "inherit" }}>
            <div className="card-header">
              <h2>{c.name}</h2>
              <span className={`pill ${c.mode}`}>{c.mode === "off" ? "Agent off" : c.mode === "shadow" ? "Shadow" : "Live"}</span>
            </div>
            <div className="muted small">You are {c.role}</div>
          </Link>
        ))}
        <form className="card" onSubmit={create}>
          <h2>New company</h2>
          <p className="muted small">One company = one brand with one Freshchat account and one agent. You become its owner.</p>
          <div className="field"><label>Company name</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Support" required minLength={2} /></div>
          <button className="primary" disabled={busy}>{busy ? "Creating…" : "Create company"}</button>
        </form>
      </div>
      {companies && companies.length === 0 && <p className="muted">No companies yet. Create one, or ask a teammate for an invite link.</p>}
    </div>
  );
}
