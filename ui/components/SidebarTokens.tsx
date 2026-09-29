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
    <div className="panel">
      <div className="panel-head">
        <div><h2>Sidebar app</h2><p>Take over and hand back from inside Freshchat, plus event forwarding to FreshQA.</p></div>
        <button className="primary" disabled={busy} onClick={() => void issue()}><Icon name="plus" /> Issue token</button>
      </div>
      {fresh && <div style={{ marginBottom: "1rem" }}><Alert tone="info"><div><strong>Copy this token now; it is not shown again.</strong><div style={{ marginTop: 8 }}><CopyBox value={fresh} /></div></div></Alert></div>}
      <ol className="small" style={{ margin: "0 0 1rem", paddingLeft: "1.2rem", lineHeight: 1.9, color: "var(--ink-2)" }}>
        <li>Pack the app: <span className="kbd">cd sidebar-app && fdk pack --skip-coverage</span></li>
        <li>Freshchat → Admin Settings → Marketplace Apps → Manage Apps → Custom Apps → Developer Portal → upload the ZIP.</li>
        <li>On the install form enter <strong>FreshQA address</strong> = <span className="kbd">{host}</span> and the token above.</li>
      </ol>
      {tokens.length > 0 && (
        <table>
          <thead><tr><th>Token</th><th>Created</th><th>Last used</th><th></th></tr></thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id}><td>{t.label} <span className="mono mute tiny">{t.id}…</span></td><td className="mute small">{timeAgo(t.createdAt)}</td><td className="mute small">{timeAgo(t.lastUsedAt)}</td>
                <td className="row end"><button className="sm ghost" disabled={busy} onClick={() => { if (confirm("Revoke this token? The installed app stops working until you enter a new one.")) api(`${base}/${t.id}`, { method: "DELETE" }).then(load).then(() => toast.success("Token revoked.")).catch((e) => toast.error(e.message)); }}><Icon name="trash" /> Revoke</button></td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
