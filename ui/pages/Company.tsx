import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router";
import { can, type Permission } from "../../shared/rbac";
import type { CompanyDetail, CompanySummary } from "../../shared/types";
import { api } from "../api";
import { AccountMenu } from "../components/AccountMenu";
import { Alert, Avatar, Icon, type IconName } from "../components/ui";

type CompanyContextValue = { company: CompanyDetail; reload: () => Promise<void>; allowed: (permission: Permission) => boolean };
const CompanyContext = createContext<CompanyContextValue | null>(null);

export function useCompany() {
  const value = useContext(CompanyContext);
  if (!value) throw new Error("useCompany must be used inside the company layout");
  return value;
}

export const modeLabel = (mode: CompanyDetail["mode"]) => (mode === "off" ? "Off" : mode === "shadow" ? "Shadow" : "Live");

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
      <div className="auth">
        <div className="card">
          <Alert tone="error">{error}</Alert>
          <p style={{ marginTop: "1rem" }}><Link to="/" className="link">Back to your companies</Link></p>
        </div>
      </div>
    );
  }

  const allowed = (permission: Permission) => (company ? can(company.role, permission) : false);
  const nav = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");

  return (
    <div>
      <header className="bar">
        <Link to="/" className="brand"><span className="mark">Q</span>FreshQA</Link>
        <div className="switcher">
          <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
            <Avatar name={company?.name ?? "…"} size="sm" />
            <span className="truncate" style={{ maxWidth: 180 }}>{company?.name ?? "Loading…"}</span>
            <Icon name="chevronDown" size={15} />
          </button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              {others.map((c) => (
                <Link key={c.id} to={`/c/${c.slug}`} onClick={() => setMenu(false)}><Avatar name={c.name} size="sm" /><span className="truncate grow">{c.name}</span>{c.slug === slug && <Icon name="check" size={14} />}</Link>
              ))}
              <div className="sep" />
              <Link to="/" onClick={() => setMenu(false)}><Icon name="plus" size={16} /> New or all companies</Link>
            </div>
          )}
        </div>
        <nav>
          {NAV.map((item) => (
            <NavLink key={item.to} to={`/c/${slug}${item.to}`} end={item.end} className={nav}>
              {item.label}
              {item.to === "/conversations" && company && company.stats.humanNow > 0 && <span className="count">{company.stats.humanNow}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="right">
          <Link className="btn sm" to={`/c/${slug}/test`}><Icon name="flask" /> Try the agent</Link>
          <AccountMenu />
        </div>
      </header>
      <main className="main page" key={slug}>
        {company ? (
          <CompanyContext.Provider value={{ company, reload, allowed }}>
            <Outlet />
          </CompanyContext.Provider>
        ) : (
          <div className="panel"><div className="skeleton title" /><div className="skeleton line" style={{ marginTop: 12 }} /></div>
        )}
      </main>
    </div>
  );
}
