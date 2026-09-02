import React, { useState, useEffect } from "react";
import { Store, Wand2, UploadCloud } from "lucide-react";
import { isAuthenticated, fetchCurrentUser, logout, onUnauthorized } from "./lib/auth.js";

import LoginPage from "./pages/LoginPage.jsx";
import AutoRosterTab from "./pages/AutoRosterTab.jsx";
import UploadExcelTab from "./pages/UploadExcelTab.jsx";

const TABS = [
  { key: "autoRoster", label: "Auto Generate Roster", icon: Wand2 },
  { key: "upload", label: "Upload Excel", icon: UploadCloud },
];

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [activeTab, setActiveTab] = useState("autoRoster");

  // Restores the session on page refresh by re-fetching the identity from
  // the backend (GET /me) rather than trusting the cached user localStorage
  // holds — role/permissions must always come from the current DB state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isAuthenticated()) {
        try {
          const user = await fetchCurrentUser();
          if (!cancelled) setAuthUser(user);
        } catch {
          // token rejected/expired — api.js already cleared it
        }
      }
      if (!cancelled) setAuthChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fires when any API call comes back 401 for an authenticated request
  // (e.g. the token expired mid-session) — drops back to the login screen.
  useEffect(() => onUnauthorized(() => setAuthUser(null)), []);

  const handleLogout = () => {
    logout();
    setAuthUser(null);
  };

  if (!authChecked) {
    return <div style={{ padding: 40, fontSize: 14, color: "#64748b" }}>กำลังตรวจสอบสิทธิ์...</div>;
  }
  if (!authUser) {
    return <LoginPage onLoggedIn={setAuthUser} />;
  }

  return (
    <div style={{ fontFamily: "'Segoe UI', 'Noto Sans Thai', sans-serif", background: "#f5f7fa", minHeight: "100vh", color: "#1e293b" }}>
      <div style={{ background: "#101b2d", padding: "14px 22px", display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "#0d9488", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Store size={16} color="#fff" />
          </div>
          <span style={{ color: "#fff", fontWeight: 800, fontSize: 15 }}>Master Roster</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "#94a3b8", fontSize: 12 }}>
            {authUser.name} · {authUser.role}
          </span>
          <button
            onClick={handleLogout}
            style={{ background: "transparent", color: "#fff", border: "1px solid #2b3b57", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}
          >
            Logout
          </button>
        </div>
      </div>

      <div style={{ background: "#fff", borderBottom: "1px solid #e5e9f0", padding: "0 22px", display: "flex", gap: 4, overflowX: "auto" }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const activeStyle = activeTab === t.key ? { borderBottom: "2px solid #0d9488", color: "#0d9488" } : { borderBottom: "2px solid transparent", color: "#64748b" };
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "12px 14px", background: "transparent", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", ...activeStyle }}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ padding: "20px 22px", maxWidth: 1180, margin: "0 auto" }}>
        {activeTab === "autoRoster" && <AutoRosterTab />}
        {activeTab === "upload" && <UploadExcelTab />}
      </div>
    </div>
  );
}
