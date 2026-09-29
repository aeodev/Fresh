import { Navigate, Route, Routes, useLocation } from "react-router";
import { ToastProvider } from "./components/ui";
import { Activity } from "./pages/Activity";
import { Companies } from "./pages/Companies";
import { Company } from "./pages/Company";
import { Conversations } from "./pages/Conversations";
import { Invite } from "./pages/Invite";
import { Knowledge } from "./pages/Knowledge";
import { Login, Signup } from "./pages/Auth";
import { Overview } from "./pages/Overview";
import { Settings } from "./pages/Settings";
import { TestChat } from "./pages/TestChat";
import { SessionProvider, useSession } from "./session";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession();
  const location = useLocation();
  if (loading) return <div style={{ minHeight: "100vh" }} />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <SessionProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/invite/:token" element={<Invite />} />
          <Route path="/" element={<RequireAuth><Companies /></RequireAuth>} />
          <Route path="/c/:slug" element={<RequireAuth><Company /></RequireAuth>}>
            <Route index element={<Overview />} />
            <Route path="knowledge" element={<Knowledge />} />
            <Route path="conversations" element={<Conversations />} />
            <Route path="conversations/:id" element={<Conversations />} />
            <Route path="test" element={<TestChat />} />
            <Route path="settings" element={<Settings />} />
            <Route path="activity" element={<Activity />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </SessionProvider>
  );
}
