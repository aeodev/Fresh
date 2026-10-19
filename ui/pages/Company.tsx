import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router";
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
  { to: "/analysis", label: "Analysis", icon: "sparkles" },
  { to: "/activity", label: "Activity", icon: "activity" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

export function Company() {
  const { slug = "" } = useParams();
  const location = useLocation();
  const inboxPage = location.pathname.startsWith(`/c/${slug}/conversations`);
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [others, setOthers] = useState<CompanySummary[]>([]);
  const [menu, setMenu] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const revealActive = () => {
      const nav = navigationRef.current;
      const active = nav?.querySelector<HTMLElement>("a.active");
      if (nav && active) nav.scrollLeft = active.offsetLeft - nav.offsetLeft - (nav.clientWidth - active.clientWidth) / 2;
    };
    const frame = requestAnimationFrame(revealActive);
    window.addEventListener("resize", revealActive);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", revealActive); };
  }, [location.pathname]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!switcherRef.current?.contains(event.target as Node)) setMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [menu]);
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
    <div className={inboxPage ? "company-shell inbox-shell" : "company-shell"}>
      <header className="bar">
        <Link to="/" className="brand"><span className="mark">Q</span>FreshQA</Link>
        <div className="switcher" ref={switcherRef}>
          <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
            <Avatar name={company?.name ?? "…"} size="sm" />
            <span className="truncate" style={{ maxWidth: 180 }}>{company?.name ?? "Loading…"}</span>
            <Icon name="chevronDown" size={15} />
          </button>
          {menu && (
            <div className="menu">
              {others.map((c) => (
                <Link key={c.id} to={`/c/${c.slug}`} onClick={() => setMenu(false)}><Avatar name={c.name} size="sm" /><span className="truncate grow">{c.name}</span>{c.slug === slug && <Icon name="check" size={14} />}</Link>
              ))}
              <div className="sep" />
              <Link to="/" onClick={() => setMenu(false)}><Icon name="plus" size={16} /> New or all companies</Link>
            </div>
          )}
        </div>
        <nav ref={navigationRef} aria-label="Company navigation">
          {NAV.map((item) => (
            <NavLink key={item.to} to={`/c/${slug}${item.to}`} end={item.end} className={nav}>
              {item.label}
              {item.to === "/conversations" && company && company.stats.humanNow > 0 && <span className="count">{company.stats.humanNow}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="right">

          <AccountMenu />
        </div>
      </header>
      <main className={inboxPage ? "main page conversation-main" : "main page"} key={slug}>
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
