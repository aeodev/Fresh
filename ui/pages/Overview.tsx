import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { AgentMode, AgentSettings, ConversationRow, EventRow, FreshchatConnection, KnowledgeVersion } from "../../shared/types";
import { api, timeAgo } from "../api";
import { Avatar, Chip, EmptyState, Icon, Orb, useToast } from "../components/ui";
import { eventIcon, summarize } from "./Activity";
import { useCompany } from "./Company";

export function Overview() {
  const { company, allowed, reload } = useCompany();
  const toast = useToast();
  const navigate = useNavigate();
  const [people, setPeople] = useState<ConversationRow[] | null>(null);
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [connection, setConnection] = useState<FreshchatConnection | null>(null);
  const [active, setActive] = useState<KnowledgeVersion | null>(null);
  const [switching, setSwitching] = useState(false);
  const base = `/c/${company.slug}`;
  const s = company.setup;

  useEffect(() => {
    const p = `/api/companies/${company.slug}`;
    api<{ conversations: ConversationRow[] }>(`${p}/conversations?state=human&limit=6`).then((r) => setPeople(r.conversations)).catch(() => setPeople([]));
    api<{ events: EventRow[] }>(`${p}/events?limit=8`).then((r) => setEvents(r.events)).catch(() => setEvents([]));
    api<{ connection: FreshchatConnection | null }>(`${p}/connection`).then((r) => setConnection(r.connection)).catch(() => setConnection(null));
    api<{ active: { version: KnowledgeVersion } | null }>(`${p}/knowledge`).then((r) => setActive(r.active?.version ?? null)).catch(() => setActive(null));
  }, [company.slug]);

  const setMode = async (mode: AgentMode) => {
    if (mode === company.mode || switching) return;
    setSwitching(true);
    try {
      await api<{ settings: AgentSettings }>(`/api/companies/${company.slug}/agent/settings`, { method: "PUT", body: { mode } });
      await reload();
      toast.success(mode === "live" ? "The agent is live." : mode === "shadow" ? "Shadow mode: drafts only." : "Agent switched off.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the mode.");
    } finally {
      setSwitching(false);
    }
  };

  const name = connection?.replyAgentName?.split(/[·(]/)[0].trim() || "Your agent";
  const headline =
    company.mode === "live" ? <>{name} is <em>live</em>.</> : company.mode === "shadow" ? <>{name} is <em>rehearsing</em>.</> : <>{name} is <em>asleep</em>.</>;
  const sentence =
    company.mode === "live"
      ? `Answering every new customer message from ${active ? `knowledge v${active.number}` : "the active knowledge"}. Your team can take over any chat.`
      : company.mode === "shadow"
        ? "Drafting a reply for every customer message and keeping it here. Nothing reaches customers until you go live."
        : s.connected && s.knowledgeActive
          ? "Everything is wired up. Start in shadow mode to watch what it would say."
          : "Finish the steps below, then start in shadow mode.";

  const steps: Array<{ done: boolean; label: string; to: string; hint: string }> = [
    { done: s.connected, label: "Connect Freshchat", to: `${base}/settings#connection`, hint: "API URL and key, verified by listing your agents." },
    { done: s.replyAgentSet, label: "Choose the reply agent", to: `${base}/settings#connection`, hint: "A dedicated agent seat the bot posts as." },
    { done: s.knowledgeActive, label: "Activate knowledge", to: `${base}/knowledge`, hint: "The agent answers only from the active version." },
    { done: s.goldenTestsPassing === true, label: "Golden tests pass", to: `${base}/knowledge`, hint: s.goldenTestsPassing === null ? "Add a few question/answer pairs and run them." : s.goldenTestsPassing ? "All green." : "Some fail. Fix the documents." },
    { done: s.sidebarTokenIssued, label: "Install the sidebar", to: `${base}/settings#sidebar`, hint: "Take over and hand back from inside Freshchat." },
    { done: s.mode === "live", label: "Go live", to: `${base}/settings#agent`, hint: "Shadow first, then flip the switch." },
  ];
  const done = steps.filter((x) => x.done).length;
  const nextIndex = steps.findIndex((x) => !x.done);

  return (
    <>
      <section className="presence">
        <div className="who">
          <Orb mode={company.mode} />
          <div>
            <h1 className="display">{headline}</h1>
            <p className="sentence">{sentence}</p>
            <div className="controls">
              {allowed("agent.mode") ? (
                <div className="modes" role="radiogroup" aria-label="Agent mode">
                  {(["off", "shadow", "live"] as AgentMode[]).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={company.mode === m} disabled={switching} className={company.mode === m ? `on ${m}` : ""} onClick={() => void setMode(m)}>
                      <Icon name={m === "off" ? "power" : m === "shadow" ? "moon" : "bolt"} size={15} /> {m === "off" ? "Off" : m === "shadow" ? "Shadow" : "Live"}
                    </button>
                  ))}
                </div>
              ) : <Chip tone={company.mode} dot>{company.mode}</Chip>}
              <Link className="btn" to={`${base}/test`}><Icon name="flask" /> Try it</Link>
            </div>
          </div>
        </div>
        <div className="today">
          <div>
            <div className="label">Today</div>
            <div className="grid">
              <div><strong className="num">{company.stats.conversationsToday}</strong><span>conversations</span></div>
              <div><strong className="num">{company.stats.sentToday}</strong><span>replies sent</span></div>
              <div><strong className="num">{company.stats.handoffsToday}</strong><span>handed to people</span></div>
              <div><strong className="num">{company.stats.humanNow}</strong><span>owned by people now</span></div>
            </div>
          </div>
          <div className="foot">{active ? `Knowledge v${active.number} · ${active.chunkCount} chunks · ${active.docCount} document${active.docCount === 1 ? "" : "s"}` : "No knowledge active yet."}</div>
        </div>
      </section>

      <section>
        <div className="row between" style={{ marginBottom: "0.9rem" }}>
          <h2>Set up your agent</h2>
          <span className="mute small num">{done} of {steps.length} done</span>
        </div>
        <div className="stepper">
          {steps.map((step, i) => (
            <div key={step.label} className={`step ${step.done ? "done" : ""} ${i === nextIndex ? "next" : ""}`} role="link" tabIndex={0} onClick={() => navigate(step.to)} onKeyDown={(e) => { if (e.key === "Enter") navigate(step.to); }}>
              <span className="n">{step.done ? <Icon name="check" size={14} /> : i + 1}</span>
              <strong>{step.label}</strong>
              <span>{step.hint}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="cols two">
        <div className="panel">
          <div className="panel-head"><div><h2>Needs a person</h2><p>Chats a teammate owns right now.</p></div><Link to={`${base}/conversations?state=human`} className="link small">View all</Link></div>
          {people === null ? <div className="skeleton line" /> : people.length === 0 ? (
            <EmptyState icon="check" title="Nobody is waiting">Every open chat is with the agent or resolved.</EmptyState>
          ) : (
            <ul className="list">
              {people.map((c) => (
                <li key={c.id} className="click" onClick={() => navigate(`${base}/conversations/${encodeURIComponent(c.id)}`)}>
                  <Avatar name={c.customerName || c.id} />
                  <div className="grow"><strong>{c.customerName || c.id.slice(0, 8)}</strong><div className="mute small truncate">{c.stateReason}</div></div>
                  <span className="mute-2 tiny">{timeAgo(c.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel">
          <div className="panel-head"><div><h2>Latest activity</h2><p>What the agent and your team did most recently.</p></div><Link to={`${base}/activity`} className="link small">Everything</Link></div>
          {events === null ? <div className="skeleton line" /> : events.length === 0 ? (
            <EmptyState icon="activity" title="Quiet so far">Events appear here as you set things up and chats arrive.</EmptyState>
          ) : (
            <ul className="timeline">
              {events.map((e) => {
                const { icon, tone } = eventIcon(e.type);
                return (
                  <li key={e.id} className="ev">
                    <span className={`ico ${tone}`}><Icon name={icon} /></span>
                    <div><div className="what">{e.type.replace(/_/g, " ")}</div><div className="detail">{summarize(e.detail)}</div></div>
                    <span className="mute-2 tiny" style={{ whiteSpace: "nowrap" }}>{timeAgo(e.createdAt)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
