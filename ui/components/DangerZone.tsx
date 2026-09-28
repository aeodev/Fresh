import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import { useCompany } from "../pages/Company";

export function DangerZone() {
  const { company, allowed, reload } = useCompany();
  const navigate = useNavigate();
  const base = `/api/companies/${company.slug}`;
  const [name, setName] = useState(company.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrap = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Company</h2>
      {error && <div className="alert error">{error}</div>}
      {allowed("company.update") && (
        <div className="row" style={{ marginBottom: "1rem" }}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 320 }} />
          <button disabled={busy || name.trim() === company.name} onClick={() => void wrap(async () => { await api(base, { method: "PATCH", body: { name } }); await reload(); })}>Rename</button>
        </div>
      )}
      <div className="row">
        <button className="danger" disabled={busy} onClick={() => { if (confirm("Leave this company?")) void wrap(async () => { await api(`${base}/leave`, { body: {} }); navigate("/"); }); }}>Leave company</button>
        {allowed("company.delete") && (
          <button className="danger" disabled={busy} onClick={() => { if (prompt(`Type the company name to delete it and everything in it:`) === company.name) void wrap(async () => { await api(base, { method: "DELETE" }); navigate("/"); }); }}>Delete company</button>
        )}
      </div>
    </div>
  );
}
