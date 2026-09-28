import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "../shared/types";
import { api } from "./api";

type Session = { user: User | null; loading: boolean; setUser: (user: User | null) => void; logout: () => Promise<void> };
const SessionContext = createContext<Session>({ user: null, loading: true, setUser: () => {}, logout: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<{ user: User }>("/api/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);
  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST", body: {} });
    setUser(null);
  }, []);
  return <SessionContext.Provider value={{ user, loading, setUser, logout }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
