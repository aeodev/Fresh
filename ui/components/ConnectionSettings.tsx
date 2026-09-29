import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { FreshchatAgentOption, FreshchatConnection } from "../../shared/types";
import { api, formatDate } from "../api";
import { useCompany } from "../pages/Company";
import { Alert, Avatar, Chip, Icon, Skeleton, useToast } from "./ui";

export function CopyBox({ value }: { value: string }) {
  const toast = useToast();
  return (
    <div className="copy-box">
      <code>{value}</code>
      <button className="small" type="button" onClick={() => void navigator.clipboard.writeText(value).then(() => toast.success("Copied."))}><Icon name="copy" /> Copy</button>
    </div>
  );
}

export function ConnectionSettings() {
  const { company, allowed, reload } = useCompany();
  const toast = useToast();
  const base = `/api/companies/${company.slug}/connection`;
  const canManage = allowed("connection.manage");
  const [connection, setConnection] = useState<FreshchatConnection | null | undefined>(undefined);
  const [agents, setAgents] = useState<FreshchatAgentOption[]>([]);
  const [form, setForm] = useState({ apiBaseUrl: "", apiKey: "", appId: "", webhookPublicKey: "" });
  const [agentId, setAgentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

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
    try {
      const r = await api<{ connection: FreshchatConnection; agents: FreshchatAgentOption[] }>(base, { method: "PUT", body: form });
      setConnection(r.connection);
      setAgents(r.agents);
      setForm((f) => ({ ...f, apiKey: "" }));
      toast.success(`Connected. ${r.agents.length} agent${r.agents.length === 1 ? "" : "s"} found. Pick the reply agent.`);
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
    try {
      await api(`${base}/reply-agent`, { method: "PUT", body: { agentId: agent.id, agentName: agent.name } });
      toast.success(`Replies will be posted as ${agent.name}.`);
      await load();
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  if (connection === undefined) return <div className="card"><Skeleton /></div>;
  const healthy = Boolean(connection?.verifiedAt && !connection.lastError);

  return (
    <div className="card">
      <div className="card-header">
        <div className="row" style={{ gap: "0.8rem" }}>
          <span className={`tile-ico ${healthy ? "tone-brand" : "tone-gray"}`} style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center" }}><Icon name="link" /></span>
          <div><h2>Freshchat connection</h2><p>{connection ? `${connection.apiBaseUrl} · verified ${formatDate(connection.verifiedAt)}` : "The API key stays on the server and is encrypted at rest."}</p></div>
        </div>
        {connection && <Chip tone={healthy ? "ok" : "danger"} dot>{healthy ? "Connected" : "Check settings"}</Chip>}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {connection?.lastError && <Alert tone="warn">Last error: {connection.lastError}</Alert>}
      {canManage ? (
        <form onSubmit={save}>
          <div className="grid-2">
            <div className="field"><label>Freshchat API URL</label><input type="text" value={form.apiBaseUrl} onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })} placeholder="https://yourcompany.freshchat.com" required /><div className="hint">Admin → API Settings shows it. /v2 is added for you.</div></div>
            <div className="field"><label>API key {connection && <span className="muted">(saved {connection.apiKeyMasked}; leave blank to keep)</span>}</label><input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={connection ? "••••••••" : "Paste the API key"} required={!connection} autoComplete="off" /></div>
          </div>
          <button type="button" className="link-button small" onClick={() => setAdvanced((a) => !a)}>{advanced ? "Hide" : "Show"} advanced</button>
          {advanced && (
            <div className="grid-2" style={{ marginTop: "0.6rem" }}>
              <div className="field"><label>Freshchat app id <span className="muted">(optional)</span></label><input type="text" value={form.appId} onChange={(e) => setForm({ ...form, appId: e.target.value })} placeholder="From the widget install snippet" /><div className="hint">When set, events from any other account are ignored.</div></div>
              <div className="field"><label>Webhook public key <span className="muted">(optional)</span></label><textarea value={form.webhookPublicKey} onChange={(e) => setForm({ ...form, webhookPublicKey: e.target.value })} placeholder="-----BEGIN PUBLIC KEY----- … from Admin → Webhooks" style={{ minHeight: 70 }} /></div>
            </div>
          )}
          <div className="row end" style={{ marginTop: "0.6rem" }}><button className="primary" disabled={busy}>{busy ? "Verifying…" : <><Icon name="check" /> {connection ? "Save & re-verify" : "Save & verify"}</>}</button></div>
        </form>
      ) : (
        <p className="muted">{connection ? `Connected to ${connection.apiBaseUrl}.` : "Not connected. Ask an admin to connect Freshchat."}</p>
      )}

      {connection && (
        <div className="grid-2" style={{ marginTop: "1.2rem", paddingTop: "1.2rem", borderTop: "1px solid var(--border)" }}>
          <div>
            <h3>Reply agent</h3>
            <p className="muted small" style={{ margin: "0.3rem 0 0.7rem" }}>Create a dedicated agent seat in Freshchat (say, "Ava · Support") and pick it. Every reply is posted as that agent; a message from any other agent means a teammate took over.</p>
            <div className="row">
              {connection.replyAgentName && <Avatar name={connection.replyAgentName} kind="bot" />}
              {canManage ? (
                <>
                  <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="grow" style={{ width: "auto" }}>
                    <option value="">Choose an agent…</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.email ? ` (${a.email})` : ""}</option>)}
                  </select>
                  <button disabled={busy || !agentId || agentId === connection.replyAgentId} onClick={() => void saveAgent()}>Save</button>
                </>
              ) : <strong>{connection.replyAgentName ?? "not set"}</strong>}
            </div>
          </div>
          <div>
            <h3>Webhook URL</h3>
            <p className="muted small" style={{ margin: "0.3rem 0 0.7rem" }}>Only if you are not using the sidebar app: paste it in Freshchat → Admin → Webhooks and enable message and conversation events.</p>
            <CopyBox value={connection.webhookUrl} />
            <div className="row" style={{ marginTop: 8 }}>
              <span className="muted tiny">Signature check {connection.webhookPublicKeySet ? "on" : "off"}</span>
              {canManage && <button className="small ghost" disabled={busy} onClick={() => { if (confirm("Rotate the secret? The old webhook URL stops working.")) { setBusy(true); api<{ connection: FreshchatConnection }>(`${base}/rotate-webhook-secret`, { body: {} }).then((r) => { setConnection(r.connection); toast.success("Secret rotated."); }).catch((e) => toast.error(e.message)).finally(() => setBusy(false)); } }}><Icon name="refresh" /> Rotate secret</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
