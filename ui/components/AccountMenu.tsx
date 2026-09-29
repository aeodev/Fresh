import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useSession } from "../session";
import { Avatar, Icon } from "./ui";

/** The avatar in the top bar. One click opens who you are, where else you can go, and sign out. */
export function AccountMenu() {
  const { user, logout } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!user) return null;
  return (
    <div className="account" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={user.name}>
        <Avatar name={user.name} size="sm" />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="me">
            <Avatar name={user.name} />
            <div className="grow"><strong className="truncate">{user.name}</strong><span className="truncate">{user.email}</span></div>
          </div>
          <div className="sep" />
          <Link to="/" role="menuitem" onClick={() => setOpen(false)}><Icon name="building" size={16} /> All companies</Link>
          <button type="button" role="menuitem" onClick={() => void logout()}><Icon name="logout" size={16} /> Sign out</button>
        </div>
      )}
    </div>
  );
}
