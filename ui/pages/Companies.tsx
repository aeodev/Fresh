import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import type { CompanySummary } from "../../shared/types";
import { api } from "../api";
import { AccountMenu } from "../components/AccountMenu";
import { Alert, Chip, Icon, Orb, Skeleton, greeting } from "../components/ui";
import { useSession } from "../session";
import { modeLabel } from "./Company";

export function Companies() {
  const { user } = useSession();
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
    <div>
      <header className="bar">
        <span className="brand"><span className="mark">Q</span>FreshQA</span>
        <div className="right"><AccountMenu /></div>
      </header>
      <main className="main page">
        <div className="head">
          <div>
            <h1 className="display">{user ? greeting(user.name) : "Companies"}.</h1>
            <p>Each company runs one agent on its own Freshchat account with its own knowledge. Pick one, or start a new one.</p>
          </div>
          {!showForm && <button className="primary" onClick={() => setCreating(true)}><Icon name="plus" /> New company</button>}
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        {companies === null ? (
          <div className="cols three"><div className="panel"><Skeleton /></div><div className="panel"><Skeleton /></div></div>
        ) : (
          <div className="cols three">
            {companies.map((c) => (
              <Link key={c.id} to={`/c/${c.slug}`} className="panel" style={{ display: "flex", flexDirection: "column", gap: "1.25rem", minHeight: 210 }}>
                <div className="row between"><Orb mode={c.mode} /><Chip tone={c.mode} dot>{modeLabel(c.mode)}</Chip></div>
                <div>
                  <h2 className="display" style={{ fontSize: "1.5rem" }}>{c.name}</h2>
                  <div className="mute small" style={{ marginTop: "0.25rem" }}>You are {c.role}</div>
                </div>
              </Link>
            ))}
            {showForm && (
              <form className="panel new-company-card" onSubmit={create}>
                <div className="row" style={{ marginBottom: "0.75rem" }}><span className="new-company-mark" aria-hidden="true"><Icon name="building" size={20} /></span><h2>New company</h2></div>
                <p className="mute small" style={{ marginBottom: "1.1rem" }}>One brand, one Freshchat account, one agent. You become the owner and can invite your team.</p>
                <div className="field"><label>Company name</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Support" required minLength={2} autoFocus /></div>
                <div className="row">
                  <button className="primary" disabled={busy}>{busy ? "Creating…" : "Create company"}</button>
                  {companies.length > 0 && <button type="button" className="ghost" onClick={() => setCreating(false)}>Cancel</button>}
                </div>
              </form>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
