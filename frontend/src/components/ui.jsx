import React from "react";

// Inline-styled primitives for the two screens that came over from the team's
// standalone frontend (SalesForecastTab, UploadExcelTab) and were never
// reskinned: they spread `th`/`td`/`inp` into ~150 inline style objects, so
// they cannot use components/common/ (Card, Button, ...) without being
// rewritten end to end. This file exists only to keep those two working.
//
// It is NOT this project's design system — components/common/ is. Nothing new
// should import from here; a screen that needs a Card or a Button takes it
// from components/common/.
//
// Restored after commit 07dffb6 deleted it while both importers were still
// live, which broke /forecast and /admin/import/excel at dev-server startup.
// Only the six exports those two pages import were restored; the original's
// Select and Badge had no importer and were left out.

export const th = { textAlign: "left", padding: "8px 10px", fontSize: 12, color: "#64748b", fontWeight: 700, background: "#f8fafc" };
export const td = { padding: "7px 10px", borderBottom: "1px solid #f1f5f9" };
export const inp = { border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: 13 };

export const Card = ({ title, icon: Icon, children, right }) => (
  <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(15,23,42,0.08)", border: "1px solid #eef1f5", padding: 20, marginBottom: 20 }}>
    {(title || right) && (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {Icon && <Icon size={18} color="#0d9488" />}
          {title && <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", margin: 0 }}>{title}</h3>}
        </div>
        {right}
      </div>
    )}
    {children}
  </div>
);

export const KpiTile = ({ label, value, sub, tone = "default" }) => {
  const tones = { default: "#0f766e", danger: "#dc2626", warn: "#d97706", good: "#16a34a" };
  return (
    <div style={{ background: "#f8fafc", borderRadius: 12, padding: "14px 16px", flex: 1, minWidth: 150, border: "1px solid #eef1f5" }}>
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: tones[tone], marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
    </div>
  );
};

export const Btn = ({ children, onClick, variant = "primary", icon: Icon, disabled, small }) => {
  const styles = {
    primary: { background: "#0d9488", color: "#fff" },
    outline: { background: "#fff", color: "#0d9488", border: "1px solid #0d9488" },
    danger: { background: "#fff", color: "#dc2626", border: "1px solid #fecaca" },
    ghost: { background: "#f1f5f9", color: "#334155" },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...styles[variant],
        border: styles[variant].border || "none",
        borderRadius: 9,
        padding: small ? "6px 10px" : "9px 16px",
        fontSize: small ? 12 : 13,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {Icon && <Icon size={small ? 13 : 15} />}
      {children}
    </button>
  );
};
