import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { FreshchatAgentOption, FreshchatConnection } from "../../shared/types";
import { api, formatDate } from "../api";
import { useCompany } from "../pages/Company";

export function CopyBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-box">
      <code>{value}</code>
      <button className="small" type="button" onClick={() => { void navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}

export function ConnectionSettings() {
  const { company, allowed, reload } = useCompany();
  const base = `/api/companies/${company.slug}/connection`;
  const canManage = allowed("connection.manage");
  const [connection, setConnection] = useState<FreshchatConnection | null | undefined>(undefined);
  const [agents, setAgents] = useState<FreshchatAgentOption[]>([]);
  const [form, setForm] = useState({ apiBaseUrl: "", apiKey: "", appId: "", webhookPublicKey: "" });
  const [agentId, setAgentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ connection: FreshchatConnection | null }>(base);
    setConnection(r.connection);
    if (r.connection) {
      setForm((f) => ({ ...f, apiBaseUrl: r.connection!.apiBaseUrl, appId: r.connection!.appId ?? "" }));
      setAgentId(r.connection.replyAgentId ?? "");
      if (canManage) api<{ agents: FreshchatAgentOption[] }>(`${base}/agents`).then((a) => setAgents(a.agents)).catch(() => setAgents([]));
    }
  }, [base, canManage]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ connection: FreshchatConnection; agents: FreshchatAgentOption[] }>(base, { method: "PUT", body: form });
      setConnection(r.connection);
      setAgents(r.agents);
      setForm((f) => ({ ...f, apiKey: "" }));
      setNotice(`Connected. Freshchat returned ${r.agents.length} agent${r.agents.length === 1 ? "" : "s"}. Now pick the reply agent.`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect.");
    } finally {
      setBusy(false);
    }
  };

  const saveAgent = async () => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/reply-agent`, { method: "PUT", body: { agentId: agent.id, agentName: agent.name } });
      setNotice(`Replies will be posted as ${agent.name}.`);
      await load();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  if (connection === undefined) return <div className="card"><p className="muted">Loading…</p></div>;

  return (
    <div className="card">
      <div className="card-header">
        <div><h2>Freshchat connection</h2><p className="muted small">The API key stays on the server{connection ? `; last verified ${formatDate(connection.verifiedAt)}` : ""}.</p></div>
        {connection && <span className={`pill ${connection.verifiedAt && !connection.lastError ? "ok" : "danger"}`}>{connection.verifiedAt && !connection.lastError ? "Connected" : "Check settings"}</span>}
      </div>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert info">{notice}</div>}
      {connection?.lastError && <div className="alert warn">Last error: {connection.lastError}</div>}
      {canManage ? (
        <form onSubmit={save} className="grid-2">
          <div>
            <div className="field"><label>Freshchat API URL</label><input type="text" value={form.apiBaseUrl} onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })} placeholder="https://yourcompany.freshchat.com" required /><div className="hint">Admin → API Settings shows it. /v2 is added for you.</div></div>
            <div className="field"><label>API key {connection && <span className="muted">(saved: {connection.apiKeyMasked}; leave blank to keep)</span>}</label><input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={connection ? "••••••••" : "Paste the API key"} required={!connection} autoComplete="off" /></div>
          </div>
          <div>
            <div className="field"><label>Freshchat app id <span className="muted">(optional)</span></label><input type="text" value={form.appId} onChange={(e) => setForm({ ...form, appId: e.target.value })} placeholder="From the widget install snippet" /><div className="hint">When set, events from any other account are ignored.</div></div>
            <div className="field"><label>Webhook public key <span className="muted">(optional)</span></label><textarea value={form.webhookPublicKey} onChange={(e) => setForm({ ...form, webhookPublicKey: e.target.value })} placeholder="-----BEGIN PUBLIC KEY----- … from Admin → Webhooks" style={{ minHeight: 70 }} /></div>
          </div>
          <div className="row"><button className="primary" disabled={busy}>{busy ? "Verifying…" : connection ? "Save & re-verify" : "Save & verify"}</button></div>
        </form>
      ) : (
        <p className="muted">{connection ? `Connected to ${connection.apiBaseUrl}.` : "Not connected. Ask an admin to connect Freshchat."}</p>
      )}

      {connection && (
        <>
          <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "1.25rem 0" }} />
          <div className="grid-2">
            <div>
              <h3>Reply agent</h3>
              <p className="muted small">Create a dedicated agent seat in Freshchat (for example "Ava · Support") and pick it here. Every reply is posted as that agent, and messages from any other agent count as a teammate taking over.</p>
              {canManage ? (
                <div className="row">
                  <select value={agentId} onChange={(e) => setAgentId(e.target.value)} style={{ flex: 1 }}>
                    <option value="">Choose an agent…</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.email ? ` (${a.email})` : ""}</option>)}
                  </select>
                  <button disabled={busy || !agentId || agentId === connection.replyAgentId} onClick={() => void saveAgent()}>Save</button>
                </div>
              ) : null}
              <p className="small" style={{ marginTop: 8 }}>Current: <strong>{connection.replyAgentName ?? "not set"}</strong></p>
            </div>
            <div>
              <h3>Webhook URL</h3>
              <p className="muted small">Only needed if you are not using the sidebar app. Paste it in Freshchat → Admin → Webhooks and enable message and conversation events.</p>
              <CopyBox value={connection.webhookUrl} />
              {canManage && <button className="small" style={{ marginTop: 8 }} disabled={busy} onClick={() => { if (confirm("Rotate the secret? The old webhook URL stops working.")) { setBusy(true); api<{ connection: FreshchatConnection }>(`${base}/rotate-webhook-secret`, { body: {} }).then((r) => setConnection(r.connection)).catch((e) => setError(e.message)).finally(() => setBusy(false)); } }}>Rotate secret</button>}
              <p className="muted small" style={{ marginTop: 8 }}>Signature check: {connection.webhookPublicKeySet ? "on" : "off (add the public key above to enable)"}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
