import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router";
import type { EventRow } from "../../shared/types";
import { api, timeAgo } from "../api";
import { EmptyState, Icon, PageHead, Skeleton, type IconName } from "../components/ui";
import { useCompany } from "./Company";

export function eventIcon(type: string): { icon: IconName; tone: string } {
  if (type.includes("error") || type.includes("rejected") || type.includes("failed")) return { icon: "alert", tone: "t-red" };
  if (type === "turn_sent") return { icon: "send", tone: "t-green" };
  if (type === "turn_shadow" || type === "turn_review") return { icon: "moon", tone: "t-amber" };
  if (type === "turn_silent") return { icon: "moon", tone: "t-gray" };
  if (type === "turn_handoff" || type === "takeover") return { icon: "hand", tone: "t-orange" };
  if (type === "handback") return { icon: "sparkles", tone: "t-green" };
  if (type === "turn_skipped") return { icon: "clock", tone: "t-gray" };
  if (type.startsWith("ingest")) return { icon: "activity", tone: "t-blue" };
  if (type.startsWith("knowledge")) return { icon: "book", tone: "t-purple" };
  if (type.startsWith("golden")) return { icon: "target", tone: "t-purple" };
  if (type.startsWith("connection") || type.startsWith("reply_agent") || type.startsWith("sidebar")) return { icon: "link", tone: "t-blue" };
  if (type.startsWith("member") || type.startsWith("invite")) return { icon: "users", tone: "t-purple" };
  if (type === "mode_changed") return { icon: "power", tone: "t-green" };
  return { icon: "info", tone: "t-gray" };
}

export function summarize(detail: Record<string, unknown>) {
  return Object.entries(detail)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ")
    .slice(0, 220);
}

export function Activity() {
  const { company } = useCompany();
  const [events, setEvents] = useState<EventRow[] | null>(null);
  useEffect(() => {
    api<{ events: EventRow[] }>(`/api/companies/${company.slug}/events?limit=300`).then((r) => setEvents(r.events)).catch(() => setEvents([]));
  }, [company.slug]);

  const groups = new Map<string, EventRow[]>();
  for (const e of events ?? []) {
    const day = new Date(e.createdAt).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    groups.set(day, [...(groups.get(day) ?? []), e]);
  }

  return (
    <>
      <PageHead title={<>Everything that <em>happened</em>.</>} subtitle="Every decision the agent and your team made, newest first. When something looks off, the answer is in here." />
      <div className="panel">
        {events === null ? <Skeleton lines={6} title={false} /> : events.length === 0 ? <EmptyState icon="activity" title="Quiet so far">Events show up as you set things up and as chats come in.</EmptyState> : (
          <ul className="timeline">
            {[...groups.entries()].map(([day, rows]) => (
              <Fragment key={day}>
                <li className="day label">{day}</li>
                {rows.map((e) => {
                  const { icon, tone } = eventIcon(e.type);
                  return (
                    <li key={e.id} className="ev">
                      <span className={`ico ${tone}`}><Icon name={icon} /></span>
                      <div>
                        <div className="what">{e.type.replace(/_/g, " ")}{e.conversationId && <> · <Link to={`/c/${company.slug}/conversations/${encodeURIComponent(e.conversationId)}`} className="link mono tiny">{e.conversationId.slice(0, 8)}</Link></>}</div>
                        <div className="detail">{summarize(e.detail)}</div>
                      </div>
                      <span className="mute-2 tiny" style={{ whiteSpace: "nowrap" }}>{timeAgo(e.createdAt)}</span>
                    </li>
                  );
                })}
              </Fragment>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
