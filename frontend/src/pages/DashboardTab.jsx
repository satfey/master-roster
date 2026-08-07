import React from "react";
import { LayoutDashboard } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";
import { Card, KpiTile, Badge, th, td } from "../components/ui.jsx";
import { fmtNum, branchKpi } from "../lib/calc.js";

const PIE_COLORS = ["#0d9488", "#f59e0b", "#6366f1", "#ef4444", "#16a34a", "#0ea5e9"];

export default function DashboardTab({ role, branches, month, selectedBranch, salesByBranch, targetByBranch, employeesByBranch, scheduleByBranch, actualByBranch, guideline }) {
  const all = branches.map((b) => branchKpi(b.id, branches, salesByBranch, targetByBranch, employeesByBranch, scheduleByBranch, actualByBranch, guideline));

  if (role === "store_manager") {
    const k = branchKpi(selectedBranch, branches, salesByBranch, targetByBranch, employeesByBranch, scheduleByBranch, actualByBranch, guideline);
    const remaining = k.guidelineHours - k.laborHours;
    return (
      <div>
        <Card title={`ภาพรวมสาขา: ${k.name}`} icon={LayoutDashboard}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <KpiTile label="ยอดขายสะสม" value={`฿${fmtNum(k.salesActual)}`} />
            <KpiTile label="ชั่วโมงตามไกด์ไลน์" value={`${fmtNum(k.guidelineHours)} ชม.`} />
            <KpiTile label="ชั่วโมงที่ใช้ไปจริง" value={`${fmtNum(k.laborHours)} ชม.`} tone={remaining < 0 ? "danger" : "good"} />
            <KpiTile label="ชั่วโมงคงเหลือ" value={`${fmtNum(remaining)} ชม.`} tone={remaining < 0 ? "danger" : "default"} />
            <KpiTile label="ต้นทุนแรงงาน (COL)" value={`${fmtNum(k.col, 1)}%`} tone={k.col > 30 ? "danger" : "good"} />
            <KpiTile label="Productivity (บาท/ชม.)" value={`฿${fmtNum(k.productivity)}`} />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <Card title={`KPI เปรียบเทียบรายสาขา — เดือน ${month}`} icon={LayoutDashboard}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>สาขา</th>
                <th style={th}>Sales Target</th>
                <th style={th}>Sales Actual</th>
                <th style={th}>% เทียบเป้า</th>
                <th style={th}>Productivity</th>
                <th style={th}>COL %</th>
                <th style={th}>สถานะกะ</th>
              </tr>
            </thead>
            <tbody>
              {all.map((k) => (
                <tr key={k.name}>
                  <td style={{ ...td, fontWeight: 700 }}>{k.name}</td>
                  <td style={td}>฿{fmtNum(k.target)}</td>
                  <td style={td}>฿{fmtNum(k.salesActual)}</td>
                  <td style={{ ...td, color: k.target > 0 && k.salesActual < k.target ? "#dc2626" : "#16a34a", fontWeight: 700 }}>
                    {k.target > 0 ? `${fmtNum((k.salesActual / k.target) * 100, 1)}%` : "-"}
                  </td>
                  <td style={td}>฿{fmtNum(k.productivity)}</td>
                  <td style={{ ...td, color: k.col > 30 ? "#dc2626" : "#16a34a", fontWeight: 700 }}>{fmtNum(k.col, 1)}%</td>
                  <td style={td}>
                    <Badge status={k.scheduleStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="ยอดขาย: เป้าหมาย vs ยอดจริง">
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={all}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1f5" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => `฿${fmtNum(v)}`} />
              <Legend />
              <Bar dataKey="target" name="เป้าหมาย" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="salesActual" name="ยอดจริง" fill="#0d9488" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {role === "executive" && (
        <Card title="สัดส่วนต้นทุนแรงงาน (COL) แยกตามสาขา">
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={all} dataKey="laborCost" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={(e) => e.name}>
                  {all.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => `฿${fmtNum(v)}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  );
}
