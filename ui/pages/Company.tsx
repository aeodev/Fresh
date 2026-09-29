import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router";
import { can, type Permission } from "../../shared/rbac";
import type { CompanyDetail, CompanySummary } from "../../shared/types";
import { api } from "../api";
import { Alert, Avatar, Chip, Icon, type IconName } from "../components/ui";
import { useSession } from "../session";
import { modeLabel } from "./Companies";

type CompanyContextValue = { company: CompanyDetail; reload: () => Promise<void>; allowed: (permission: Permission) => boolean };
const CompanyContext = createContext<CompanyContextValue | null>(null);

export function useCompany() {
  const value = useContext(CompanyContext);
  if (!value) throw new Error("useCompany must be used inside the company layout");
  return value;
}

export function ModeChip({ mode }: { mode: CompanyDetail["mode"] }) {
  return <Chip tone={mode} dot>{modeLabel(mode)}</Chip>;
}

const NAV: Array<{ to: string; label: string; icon: IconName; end?: boolean }> = [
  { to: "", label: "Overview", icon: "home", end: true },
  { to: "/conversations", label: "Conversations", icon: "chat" },
  { to: "/knowledge", label: "Knowledge", icon: "book" },
  { to: "/test", label: "Test chat", icon: "flask" },
  { to: "/activity", label: "Activity", icon: "activity" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

export function Company() {
  const { slug = "" } = useParams();
  const { user, logout } = useSession();
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [others, setOthers] = useState<CompanySummary[]>([]);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const result = await api<{ company: CompanyDetail }>(`/api/companies/${slug}`);
      setCompany(result.company);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the company.");
    }
  }, [slug]);

  useEffect(() => {
    void reload();
    api<{ companies: CompanySummary[] }>("/api/companies").then((r) => setOthers(r.companies)).catch(() => setOthers([]));
  }, [reload]);

  if (error) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "1rem" }}>
        <div className="card" style={{ maxWidth: 420 }}>
          <Alert tone="error">{error}</Alert>
          <Link to="/"><Icon name="arrowLeft" size={14} /> Back to your companies</Link>
        </div>
      </div>
    );
  }

  const allowed = (permission: Permission) => (company ? can(company.role, permission) : false);
  const nav = ({ isActive }: { isActive: boolean }) => `nav ${isActive ? "active" : ""}`;

  return (
    <div className="shell">
      <nav className="sidenav">
        <div className="brand"><span className="logo">Q</span> FreshQA</div>
        <div className="switcher">
          <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
            <Avatar name={company?.name ?? "…"} size="sm" />
            <span className="name truncate">{company?.name ?? "Loading…"}<span className="caption" style={{ display: "block" }}>{company ? `${modeLabel(company.mode)} · ${company.role}` : ""}</span></span>
            <Icon name="chevronDown" size={16} />
          </button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              {others.map((c) => (
                <Link key={c.id} to={`/c/${c.slug}`} onClick={() => setMenu(false)}><Avatar name={c.name} size="sm" /><span className="truncate grow">{c.name}</span>{c.slug === slug && <Icon name="check" size={14} />}</Link>
              ))}
              <div className="divider" />
              <Link to="/" onClick={() => setMenu(false)}><Icon name="plus" size={16} /> New or all companies</Link>
            </div>
          )}
        </div>
        <div className="section">Workspace</div>
        {NAV.map((item) => (
          <NavLink key={item.to} to={`/c/${slug}${item.to}`} end={item.end} className={nav}>
            <Icon name={item.icon} /> {item.label}
            {item.to === "/conversations" && company && company.stats.humanNow > 0 && <span className="count">{company.stats.humanNow}</span>}
          </NavLink>
        ))}
        <div className="spacer" />
        {user && (
          <div className="user">
            <Avatar name={user.name} size="sm" />
            <div className="who"><strong className="truncate">{user.name}</strong><span className="truncate">{user.email}</span></div>
            <button type="button" title="Sign out" onClick={() => void logout()}><Icon name="logout" size={16} /></button>
          </div>
        )}
      </nav>
      <main className="main page" key={slug}>
        {company ? (
          <CompanyContext.Provider value={{ company, reload, allowed }}>
            <Outlet />
          </CompanyContext.Provider>
        ) : (
          <div className="card"><div className="skeleton title" /><div className="skeleton line" style={{ marginTop: 10 }} /></div>
        )}
      </main>
    </div>
  );
}
