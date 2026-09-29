import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { AgentMode, AgentSettings, ConversationRow, FreshchatConnection } from "../../shared/types";
import { api, timeAgo } from "../api";
import { Avatar, Chip, EmptyState, Icon, PageHeader, Ring, useToast, type IconName } from "../components/ui";
import { useCompany } from "./Company";

export function Overview() {
  const { company, allowed, reload } = useCompany();
  const toast = useToast();
  const navigate = useNavigate();
  const [attention, setAttention] = useState<ConversationRow[] | null>(null);
  const [connection, setConnection] = useState<FreshchatConnection | null>(null);
  const [switching, setSwitching] = useState(false);
  const base = `/c/${company.slug}`;
  const s = company.setup;

  useEffect(() => {
    api<{ conversations: ConversationRow[] }>(`/api/companies/${company.slug}/conversations?state=human&limit=8`).then((r) => setAttention(r.conversations)).catch(() => setAttention([]));
    api<{ connection: FreshchatConnection | null }>(`/api/companies/${company.slug}/connection`).then((r) => setConnection(r.connection)).catch(() => setConnection(null));
  }, [company.slug]);

  const setMode = async (mode: AgentMode) => {
    if (mode === company.mode) return;
    setSwitching(true);
    try {
      await api<{ settings: AgentSettings }>(`/api/companies/${company.slug}/agent/settings`, { method: "PUT", body: { mode } });
      await reload();
      toast.success(mode === "live" ? "The agent is live." : mode === "shadow" ? "Shadow mode on: drafts only." : "Agent switched off.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the mode.");
    } finally {
      setSwitching(false);
    }
  };

  const agentName = connection?.replyAgentName || "Your agent";
  const steps: Array<{ done: boolean; label: string; to: string; hint: string }> = [
    { done: s.connected, label: "Connect Freshchat", to: `${base}/settings#connection`, hint: "API URL and key, verified by listing your agents." },
    { done: s.replyAgentSet, label: "Pick the reply agent", to: `${base}/settings#connection`, hint: "A dedicated agent seat the bot replies as." },
    { done: s.knowledgeActive, label: "Activate knowledge", to: `${base}/knowledge`, hint: "The agent answers only from the active version." },
    { done: s.goldenTestsPassing === true, label: "Golden tests passing", to: `${base}/knowledge`, hint: s.goldenTestsPassing === null ? "Add a few question/answer pairs and run them." : s.goldenTestsPassing ? "All passing." : "Some tests fail; fix the documents." },
    { done: s.sidebarTokenIssued, label: "Install the Freshchat sidebar", to: `${base}/settings#sidebar`, hint: "Take over / Hand back for your team, plus event forwarding." },
    { done: s.mode === "live", label: "Go live", to: `${base}/settings#agent`, hint: "Start in shadow mode, watch the drafts, then switch to live." },
  ];
  const done = steps.filter((x) => x.done).length;
  const headline = company.mode === "live" ? `${agentName} is live` : company.mode === "shadow" ? `${agentName} is in shadow mode` : `${agentName} is switched off`;
  const sub = company.mode === "live" ? "Answering every new customer message from the active knowledge. People can take over any chat." : company.mode === "shadow" ? "Drafting a reply for every customer message and recording it. Nothing reaches customers yet." : "Finish setup, then start in shadow mode to see what it would say.";

  const tiles: Array<{ icon: IconName; tone: string; value: number; label: string }> = [
    { icon: "chat", tone: "tone-sky", value: company.stats.conversationsToday, label: "Conversations today" },
    { icon: "send", tone: "tone-brand", value: company.stats.sentToday, label: "Replies sent" },
    { icon: "hand", tone: "tone-coral", value: company.stats.handoffsToday, label: "Handoffs" },
    { icon: "users", tone: "tone-violet", value: company.stats.humanNow, label: "Owned by people" },
  ];

  return (
    <>
      <PageHeader eyebrow="Overview" title={company.name} subtitle="What your agent is doing today." actions={<Link className="btn" to={`${base}/test`}><Icon name="flask" /> Try the agent</Link>} />
      <div className="hero">
        <div className="grid">
          <Avatar name={agentName} kind="bot" size="lg" />
          <div>
            <h2>{headline}</h2>
            <p>{sub}</p>
            <div className="stat-row">
              <div><strong>{company.stats.sentToday}</strong><span>Replies today</span></div>
              <div><strong>{company.stats.handoffsToday}</strong><span>Handoffs</span></div>
              <div><strong>{done}/{steps.length}</strong><span>Setup steps</span></div>
            </div>
          </div>
          {allowed("agent.mode") && (
            <div className="segmented" style={{ background: "rgba(255,255,255,0.08)" }}>
              {(["off", "shadow", "live"] as AgentMode[]).map((m) => (
                <button key={m} type="button" disabled={switching} className={company.mode === m ? "active" : ""} style={company.mode === m ? undefined : { color: "#c7d0e0" }} onClick={() => void setMode(m)}>
                  {m === "off" ? "Off" : m === "shadow" ? "Shadow" : "Live"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="tiles">
        {tiles.map((t) => (
          <div key={t.label} className="tile"><span className={`ico ${t.tone}`}><Icon name={t.icon} /></span><div><div className="value">{t.value}</div><div className="label">{t.label}</div></div></div>
        ))}
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div className="row" style={{ gap: "0.9rem" }}>
              <Ring value={done / steps.length} label={`${Math.round((done / steps.length) * 100)}%`} />
              <div><h2>Setup</h2><p>{done === steps.length ? "Everything is in place." : `${steps.length - done} step${steps.length - done === 1 ? "" : "s"} to go.`}</p></div>
            </div>
          </div>
          <ul className="checklist">
            {steps.map((step) => (
              <li key={step.label} className={step.done ? "done" : ""} onClick={() => navigate(step.to)} style={{ cursor: "pointer" }} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") navigate(step.to); }}>
                <span className={`mark ${step.done ? "done" : ""}`}><Icon name="check" /></span>
                <div className="grow">
                  <span className="title" style={{ color: step.done ? undefined : "var(--ink)" }}>{step.label}</span>
                  <div className="muted small">{step.hint}</div>
                </div>
                {!step.done && <Icon name="arrowRight" size={16} className="subtle" />}
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="card-header"><div><h2>Needs a person</h2><p>Chats a teammate owns right now.</p></div><Link to={`${base}/conversations?state=human`} className="small strong">View all</Link></div>
          {attention === null ? <div className="skeleton line" /> : attention.length === 0 ? (
            <EmptyState icon="check" title="Nobody is waiting">Every open chat is with the agent or resolved.</EmptyState>
          ) : (
            <table>
              <tbody>
                {attention.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => navigate(`${base}/conversations/${encodeURIComponent(c.id)}`)}>
                    <td style={{ width: 44 }}><Avatar name={c.customerName || c.id} /></td>
                    <td><strong>{c.customerName || c.id.slice(0, 8)}</strong><div className="muted small truncate" style={{ maxWidth: 260 }}>{c.stateReason}</div></td>
                    <td className="muted small" style={{ whiteSpace: "nowrap", textAlign: "right" }}>{timeAgo(c.updatedAt)}{c.needsAttention && <div><Chip tone="warn">attention</Chip></div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
