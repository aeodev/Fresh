import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { EventRow } from "../../shared/types";
import { api, timeAgo } from "../api";
import { useCompany } from "./Company";

export function Activity() {
  const { company } = useCompany();
  const [events, setEvents] = useState<EventRow[] | null>(null);
  useEffect(() => {
    api<{ events: EventRow[] }>(`/api/companies/${company.slug}/events?limit=200`).then((r) => setEvents(r.events)).catch(() => setEvents([]));
  }, [company.slug]);
  return (
    <div className="card">
      <div className="card-header"><h2>Activity</h2><span className="muted small">Every decision the agent and your team made</span></div>
      {events === null ? <p className="muted">Loading…</p> : events.length === 0 ? <p className="empty">Nothing yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Event</th><th>Conversation</th><th>Detail</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="muted small" style={{ whiteSpace: "nowrap" }}>{timeAgo(e.createdAt)}</td>
                  <td><span className={`pill ${e.type.includes("error") || e.type.includes("rejected") ? "danger" : e.type.startsWith("turn_sent") ? "ok" : e.type.includes("handoff") || e.type === "takeover" ? "warn" : ""}`}>{e.type}</span></td>
                  <td>{e.conversationId ? <Link to={`/c/${company.slug}/conversations/${encodeURIComponent(e.conversationId)}`} className="mono small">{e.conversationId.slice(0, 8)}</Link> : "—"}</td>
                  <td className="small mono muted" style={{ maxWidth: 520, overflowWrap: "anywhere" }}>{JSON.stringify(e.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
