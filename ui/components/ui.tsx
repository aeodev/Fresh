// Small shared building blocks: icons, avatars, chips, alerts, skeletons, empty states, toasts.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

const ICONS = {
  home: "M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.2A8 8 0 1 1 21 12z",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19a2 2 0 0 1 2-2h13",
  flask: "M9 3h6M10 3v6l-5.5 9A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3L14 9V3",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  plus: "M12 5v14M5 12h14",
  check: "M20 6L9 17l-5-5",
  bolt: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  sparkles: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z",
  arrowLeft: "M19 12H5M12 19l-7-7 7-7",
  arrowRight: "M5 12h14M12 5l7 7-7 7",
  x: "M18 6L6 18M6 6l12 12",
  refresh: "M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  chevronDown: "M6 9l6 6 6-6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  hand: "M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.6L3.2 15.5a2 2 0 0 1 3.4-2.1L8 15",
  bot: "M12 8V4H8M4 8h16v12H4zM2 14h2M20 14h2M15 13v2M9 13v2",
  alert: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
  play: "M5 3l14 9-14 9V3z",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6",
  copy: "M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  building: "M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01M9 18v.01",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  target: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  layers: "M12 2l10 5-10 5L2 7l10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  power: "M18.4 6.6a9 9 0 1 1-12.8 0M12 2v10",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3",
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

const HUES = ["#7c5cff", "#2f8bff", "#f2683a", "#e5484d", "#0f9d8a", "#b45309", "#db2777", "#4f46e5"];
export function hueFor(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, kind = "person", size }: { name: string; kind?: "person" | "bot" | "human"; size?: "sm" | "lg" }) {
  const cls = `avatar ${size ?? ""} ${kind === "bot" ? "bot" : ""}`;
  const style = kind === "bot" ? undefined : { background: kind === "human" ? "#0f172a" : hueFor(name) };
  return <span className={cls} style={style} title={name}>{kind === "bot" ? <Icon name="sparkles" size={size === "lg" ? 22 : 15} /> : initials(name)}</span>;
}

export function Chip({ tone = "", dot = false, children }: { tone?: string; dot?: boolean; children: ReactNode }) {
  return <span className={`chip ${tone}`}>{dot && <i />}{children}</span>;
}

/** The agent's presence. Breathes when live, warm when in shadow, grey when off. */
export function Orb({ mode }: { mode: "off" | "shadow" | "live" }) {
  return <div className={`orb ${mode}`} aria-hidden="true" />;
}

export function Alert({ tone, children }: { tone: "error" | "info" | "warn"; children: ReactNode }) {
  return (
    <div className={`alert ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={tone === "error" ? "alert" : "info"} />
      <div>{children}</div>
    </div>
  );
}

export function Skeleton({ lines = 3, title = true }: { lines?: number; title?: boolean }) {
  return (
    <div className="stack" style={{ gap: "0.6rem" }} aria-busy="true">
      {title && <div className="skeleton title" />}
      {Array.from({ length: lines }, (_, i) => <div key={i} className={`skeleton ${i === lines - 1 ? "short" : "line"}`} />)}
    </div>
  );
}

export function EmptyState({ icon = "sparkles", title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="glyph"><Icon name={icon} /></div>
      <strong>{title}</strong>
      {children && <div className="small">{children}</div>}
      {action && <div style={{ marginTop: "0.9rem" }}>{action}</div>}
    </div>
  );
}

export function PageHead({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="head">
      <div>
        <h1 className="display">{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Meter({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="meter">
      <div className="track"><i style={{ width: `${pct}%` }} /></div>
      <strong className="small">{label ?? `${pct}%`}</strong>
    </div>
  );
}

export function Ring({ value, label }: { value: number; label: string }) {
  return <div className="ring" style={{ ["--p" as string]: Math.round(value * 100) }}><span>{label}</span></div>;
}

export function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return `${part}, ${name.split(" ")[0]}`;
}

// ---- Toasts ----
type Toast = { id: number; tone: "success" | "error" | "info"; text: string };
type ToastApi = { success: (text: string) => void; error: (text: string) => void; info: (text: string) => void };
const ToastContext = createContext<ToastApi>({ success: () => {}, error: () => {}, info: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 5000 : 3200);
  }, []);
  const api = useMemo<ToastApi>(() => ({ success: (t) => push("success", t), error: (t) => push("error", t), info: (t) => push("info", t) }), [push]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}><Icon name={t.tone === "error" ? "alert" : t.tone === "success" ? "check" : "info"} />{t.text}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
