import React, { useState } from "react";
import { Store } from "lucide-react";
import { inp } from "../components/ui.jsx";
import { login, fetchCurrentUser } from "../lib/auth.js";

/** onLoggedIn receives the identity from GET /me (not the raw login response) — see auth.fetchCurrentUser. */
export default function LoginPage({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
      const user = await fetchCurrentUser();
      onLoggedIn(user);
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        fontFamily: "'Segoe UI', 'Noto Sans Thai', sans-serif",
        background: "#f5f7fa",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "#fff",
          borderRadius: 14,
          boxShadow: "0 1px 3px rgba(15,23,42,0.08)",
          border: "1px solid #eef1f5",
          padding: 32,
          width: 320,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "#0d9488", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Store size={16} color="#fff" />
          </div>
          <span style={{ fontWeight: 800, fontSize: 16, color: "#1e293b" }}>Master Roster</span>
        </div>

        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
          style={{ ...inp, width: "100%", boxSizing: "border-box", marginBottom: 16 }}
        />

        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          style={{ ...inp, width: "100%", boxSizing: "border-box", marginBottom: 16 }}
        />

        {error && <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 16 }}>{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          style={{
            width: "100%",
            background: "#0d9488",
            color: "#fff",
            border: "none",
            borderRadius: 9,
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: 600,
            cursor: submitting ? "default" : "pointer",
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? "กำลังเข้าสู่ระบบ..." : "Login"}
        </button>
      </form>
    </div>
  );
}
