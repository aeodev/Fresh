import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import { useCompany } from "../pages/Company";
import { Icon, useToast } from "./ui";

export function DangerZone() {
  const { company, allowed, reload } = useCompany();
  const navigate = useNavigate();
  const toast = useToast();
  const base = `/api/companies/${company.slug}`;
  const [name, setName] = useState(company.name);
  const [busy, setBusy] = useState(false);

  const wrap = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-head"><div><h2>Company</h2><p>Rename, leave, or delete.</p></div></div>
      {allowed("company.update") && (
        <div className="row" style={{ marginBottom: "1.25rem" }}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 340 }} />
          <button disabled={busy || name.trim() === company.name} onClick={() => void wrap(async () => { await api(base, { method: "PATCH", body: { name } }); await reload(); }, "Renamed.")}>Rename</button>
        </div>
      )}
      <div className="row">
        <button className="ghost" disabled={busy} onClick={() => { if (confirm("Leave this company?")) void wrap(async () => { await api(`${base}/leave`, { body: {} }); navigate("/"); }); }}><Icon name="logout" /> Leave company</button>
        {allowed("company.delete") && (
          <button className="danger" disabled={busy} onClick={() => { if (prompt("Type the company name to delete it and everything in it:") === company.name) void wrap(async () => { await api(base, { method: "DELETE" }); navigate("/"); }); }}><Icon name="trash" /> Delete company</button>
        )}
      </div>
    </div>
  );
}
