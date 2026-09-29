import { useEffect, useState, type FormEvent } from "react";
import type { AgentMode, AgentSettings } from "../../shared/types";
import { api } from "../api";
import { useCompany } from "../pages/Company";
import { Alert, Icon, Skeleton, useToast } from "./ui";

const MODES: Array<{ mode: AgentMode; title: string; blurb: string; icon: "power" | "moon" | "bolt" }> = [
  { mode: "off", title: "Off", blurb: "Nothing runs.", icon: "power" },
  { mode: "shadow", title: "Shadow", blurb: "Drafts every reply and records it. Sends nothing. Start here.", icon: "moon" },
  { mode: "live", title: "Live", blurb: "Sends replies to customers.", icon: "bolt" },
];

export function AgentSettingsForm() {
  const { company, allowed, reload } = useCompany();
  const toast = useToast();
  const base = `/api/companies/${company.slug}/agent/settings`;
  const canEdit = allowed("agent.settings");
  const canMode = allowed("agent.mode");
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ settings: AgentSettings }>(base).then((r) => setSettings(r.settings)).catch((e) => setError(e.message));
  }, [base]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ settings: AgentSettings }>(base, { method: "PUT", body: settings });
      setSettings(r.settings);
      toast.success(r.settings.mode === "live" ? "Saved. The agent is live." : r.settings.mode === "shadow" ? "Saved. Shadow mode: drafts only." : "Saved. The agent is off.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return <div className="card">{error ? <Alert tone="error">{error}</Alert> : <Skeleton />}</div>;
  const s = company.setup;
  const liveBlockers = [!s.connected && "connect Freshchat", !s.replyAgentSet && "pick the reply agent", !s.knowledgeActive && "activate a knowledge version"].filter(Boolean) as string[];

  return (
    <form className="card" onSubmit={save}>
      <div className="card-header"><div><h2>Agent</h2><p>How it behaves and when it is allowed to send.</p></div></div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="field">
        <label>Mode</label>
        <div className="mode-cards">
          {MODES.map((m) => {
            const blocked = m.mode === "live" && liveBlockers.length > 0;
            return (
              <div key={m.mode} role="radio" aria-checked={settings.mode === m.mode} tabIndex={0} className={`mode-card ${m.mode} ${settings.mode === m.mode ? "selected" : ""} ${!canMode || blocked ? "disabled" : ""}`} onClick={() => { if (canMode && !blocked) setSettings({ ...settings, mode: m.mode }); }}>
                <strong><Icon name={m.icon} size={16} /> {m.title}</strong>
                <p>{blocked ? `First: ${liveBlockers.join(", ")}.` : m.blurb}</p>
              </div>
            );
          })}
        </div>
      </div>
      <div className="grid-2">
        <div>
          <div className="field">
            <label>Confidence threshold · <span className="mono">{settings.confidenceThreshold.toFixed(2)}</span></label>
            <input type="range" min={0} max={1} step={0.05} value={settings.confidenceThreshold} disabled={!canEdit} onChange={(e) => setSettings({ ...settings, confidenceThreshold: Number(e.target.value) })} />
            <div className="hint">Below this, the agent hands off instead of answering. 0.6 is a sensible start.</div>
          </div>
          <div className="field">
            <label>Wait before replying · <span className="mono">{settings.debounceSeconds}s</span></label>
            <input type="range" min={0} max={12} step={1} value={settings.debounceSeconds} disabled={!canEdit} onChange={(e) => setSettings({ ...settings, debounceSeconds: Number(e.target.value) })} />
            <div className="hint">Lets a customer finish a burst of short messages before one answer goes out.</div>
          </div>
          <div className="field"><label>Handoff phrases</label><input type="text" value={settings.handoffKeywords} disabled={!canEdit} onChange={(e) => setSettings({ ...settings, handoffKeywords: e.target.value })} /><div className="hint">Comma-separated. Any of these in a customer message hands the chat to a person.</div></div>
        </div>
        <div>
          <div className="field"><label>Persona</label><textarea value={settings.persona} disabled={!canEdit} onChange={(e) => setSettings({ ...settings, persona: e.target.value })} placeholder="Warm and concise. Use the customer's first name when you know it. We are a small team in Manila; office hours are 9–6 PHT." style={{ minHeight: 150 }} /></div>
          <div className="field"><label>Handoff message <span className="muted">(optional)</span></label><input type="text" value={settings.handoffMessage} disabled={!canEdit} onChange={(e) => setSettings({ ...settings, handoffMessage: e.target.value })} placeholder="Let me get a teammate to help you with this." /><div className="hint">Sent once when the agent hands off in live mode. Leave empty to stay silent.</div></div>
        </div>
      </div>
      {(canEdit || canMode) && <div className="row end"><button className="primary" disabled={busy}>{busy ? "Saving…" : <><Icon name="check" /> Save</>}</button></div>}
    </form>
  );
}
