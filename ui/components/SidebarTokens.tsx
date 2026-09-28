import { useCallback, useEffect, useState } from "react";
import { api, timeAgo } from "../api";
import { useCompany } from "../pages/Company";
import { CopyBox } from "./ConnectionSettings";

type Token = { id: string; label: string; createdAt: string; lastUsedAt: string | null };

export function SidebarTokens() {
  const { company, reload } = useCompany();
  const base = `/api/companies/${company.slug}/sidebar-tokens`;
  const [tokens, setTokens] = useState<Token[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const host = window.location.host;

  const load = useCallback(() => api<{ tokens: Token[] }>(base).then((r) => setTokens(r.tokens)).catch((e) => setError(e.message)), [base]);
  useEffect(() => {
    void load();
  }, [load]);

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>(base, { body: { label: "Freshchat sidebar" } });
      setFresh(r.token);
      await load();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not issue a token.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <div><h2>Freshchat sidebar app</h2><p className="muted small">Gives agents Take over / Hand back inside Freshchat and forwards conversation events to FreshQA.</p></div>
        <button className="primary" disabled={busy} onClick={() => void issue()}>Issue token</button>
      </div>
      {error && <div className="alert error">{error}</div>}
      {fresh && (
        <div className="alert info">
          <strong>Copy this token now; it is not shown again.</strong>
          <div style={{ marginTop: 6 }}><CopyBox value={fresh} /></div>
        </div>
      )}
      <ol className="small">
        <li>Pack the app: <code>cd sidebar-app && fdk pack --skip-coverage</code> (see <code>sidebar-app/README.md</code>).</li>
        <li>Freshchat → Admin Settings → Marketplace Apps → Manage Apps → Custom Apps → Developer Portal → upload the ZIP.</li>
        <li>On the install form enter <strong>FreshQA address</strong> = <code>{host}</code> and the token above.</li>
      </ol>
      {tokens.length > 0 && (
        <table>
          <thead><tr><th>Token</th><th>Created</th><th>Last used</th><th></th></tr></thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id}><td>{t.label} <span className="mono muted small">{t.id}…</span></td><td className="muted small">{timeAgo(t.createdAt)}</td><td className="muted small">{timeAgo(t.lastUsedAt)}</td>
                <td className="row end"><button className="small danger" disabled={busy} onClick={() => { if (confirm("Revoke this token? The installed app stops working until you enter a new one.")) api(`${base}/${t.id}`, { method: "DELETE" }).then(load).catch((e) => setError(e.message)); }}>Revoke</button></td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
