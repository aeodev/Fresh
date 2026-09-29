import { useCallback, useEffect, useState } from "react";
import { api, timeAgo } from "../api";
import { useCompany } from "../pages/Company";
import { CopyBox } from "./ConnectionSettings";
import { Alert, Icon, useToast } from "./ui";

type Token = { id: string; label: string; createdAt: string; lastUsedAt: string | null };

export function SidebarTokens() {
  const { company, reload } = useCompany();
  const toast = useToast();
  const base = `/api/companies/${company.slug}/sidebar-tokens`;
  const [tokens, setTokens] = useState<Token[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const host = window.location.host;

  const load = useCallback(() => api<{ tokens: Token[] }>(base).then((r) => setTokens(r.tokens)).catch((e) => toast.error(e.message)), [base, toast]);
  useEffect(() => {
    void load();
  }, [load]);

  const issue = async () => {
    setBusy(true);
    try {
      const r = await api<{ token: string }>(base, { body: { label: "Freshchat sidebar" } });
      setFresh(r.token);
      await load();
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not issue a token.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <div className="row" style={{ gap: "0.8rem" }}>
          <span className="tile-ico tone-violet" style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center" }}><Icon name="bot" /></span>
          <div><h2>Freshchat sidebar app</h2><p>Take over / Hand back inside Freshchat, plus event forwarding to FreshQA.</p></div>
        </div>
        <button className="primary" disabled={busy} onClick={() => void issue()}><Icon name="plus" /> Issue token</button>
      </div>
      {fresh && (
        <Alert tone="info"><strong>Copy this token now; it is not shown again.</strong><div style={{ marginTop: 6 }}><CopyBox value={fresh} /></div></Alert>
      )}
      <ol className="small" style={{ margin: "0 0 0.9rem", paddingLeft: "1.2rem", lineHeight: 1.8 }}>
        <li>Pack the app: <span className="kbd">cd sidebar-app && fdk pack --skip-coverage</span></li>
        <li>Freshchat → Admin Settings → Marketplace Apps → Manage Apps → Custom Apps → Developer Portal → upload the ZIP.</li>
        <li>On the install form enter <strong>FreshQA address</strong> = <span className="kbd">{host}</span> and the token above.</li>
      </ol>
      {tokens.length > 0 && (
        <table>
          <thead><tr><th>Token</th><th>Created</th><th>Last used</th><th></th></tr></thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id}><td>{t.label} <span className="mono muted tiny">{t.id}…</span></td><td className="muted small">{timeAgo(t.createdAt)}</td><td className="muted small">{timeAgo(t.lastUsedAt)}</td>
                <td className="row end"><button className="small ghost" disabled={busy} onClick={() => { if (confirm("Revoke this token? The installed app stops working until you enter a new one.")) api(`${base}/${t.id}`, { method: "DELETE" }).then(load).then(() => toast.success("Token revoked.")).catch((e) => toast.error(e.message)); }}><Icon name="trash" /> Revoke</button></td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
