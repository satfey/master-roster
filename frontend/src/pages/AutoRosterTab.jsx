import React, { useState } from "react";
import { CalendarDays, Wand2, RefreshCcw, Clock } from "lucide-react";
import { Card, KpiTile, Btn, th, td, inp } from "../components/ui.jsx";
import { apiGet, apiPost } from "../lib/api.js";

/**
 * Test/visualization screen only — NOT the production roster UI.
 *
 * All scheduling (Full-time 8h + 1h break, Part-time 4-6h, opening/closing
 * coverage, weekly/monthly limits, productivity, labor budget, forecast,
 * etc.) happens entirely in the backend's rosterGenerationService. This
 * component only calls POST /api/roster/auto-generate, then fetches the
 * rosters it touched via the existing GET /roster/:id and renders exactly
 * what comes back — it never computes, guesses, or invents a shift.
 *
 * The "used / remaining hours" panel and the per-day actual-hours input are
 * the same reuse: the store manager's entry is sent to the existing
 * POST /roster/actual-hours, and the totals shown (monthly guideline, hours
 * used-or-committed, remaining) come straight from the existing
 * GET /roster/capacity (computeMonthlyCapacity) — no deduction/remaining-hours
 * math happens in this component.
 */

function toHHMM(time) {
  return time ? time.slice(0, 5) : null;
}

function datesInRange(start, end) {
  const dates = [];
  let cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

function weekdayLabel(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase();
}

function employeeTypeLabel(employee) {
  const t = (employee?.position_time_type || "").trim().toLowerCase();
  if (t.startsWith("full")) return "Full";
  if (t.startsWith("part")) return "Part";
  return "-";
}

/** Renders exactly the fields the backend returned for one shift — no derived/invented values beyond formatting. */
function ShiftCell({ shift }) {
  if (!shift) return <span style={{ color: "#cbd5e1" }}>-</span>;
  const isFullTime = employeeTypeLabel(shift.employee) === "Full";
  return (
    <div
      style={{
        background: isFullTime ? "#ecfdf5" : "#eff6ff",
        border: `1px solid ${isFullTime ? "#a7f3d0" : "#bfdbfe"}`,
        borderRadius: 8,
        padding: "6px 8px",
        fontSize: 12,
        lineHeight: 1.5,
        minWidth: 112,
      }}
    >
      <div style={{ fontWeight: 700, color: "#1e293b" }}>
        {toHHMM(shift.start_time)} - {toHHMM(shift.end_time)}
      </div>
      {shift.break_start_time && shift.break_end_time && (
        <div style={{ color: "#b45309" }}>
          Break {toHHMM(shift.break_start_time)} - {toHHMM(shift.break_end_time)}
        </div>
      )}
      <div style={{ color: "#475569" }}>{Number(shift.planned_hours)} working hours</div>
    </div>
  );
}

export default function AutoRosterTab() {
  const [storeId, setStoreId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [regenerate, setRegenerate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [shifts, setShifts] = useState([]); // real shift rows fetched back from the backend after generation
  const [capacity, setCapacity] = useState(null); // raw GET /roster/capacity response
  const [actualHoursInput, setActualHoursInput] = useState({}); // date -> string, the manager's editable entry
  const [savingActualHours, setSavingActualHours] = useState(false);

  /** Re-reads the existing monthly capacity endpoint and prefills the actual-hours inputs from it — never computed locally. */
  const refreshCapacity = async (sid, anyDateInMonth) => {
    const cap = await apiGet(`/roster/capacity?storeId=${encodeURIComponent(sid)}&month=${anyDateInMonth.slice(0, 7)}`);
    setCapacity(cap);
    const prefill = {};
    for (const d of cap.byDate) {
      if (d.actualHours != null) prefill[d.date] = String(d.actualHours);
    }
    setActualHoursInput(prefill);
  };

  const runAutoGenerate = async () => {
    if (!storeId || !startDate || !endDate) {
      setError("Enter Store ID, start date, and end date.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      // 1. The ONLY place scheduling happens — the existing backend endpoint.
      const genResult = await apiPost("/roster/auto-generate", { storeId, startDate, endDate, regenerate });
      setResult(genResult);

      // 2. Fetch the roster(s) it just wrote, via the existing GET /roster/:id, and
      //    show only the real persisted shifts for the requested range.
      const rosters = await Promise.all(genResult.rosterIds.map((id) => apiGet(`/roster/${id}`)));
      const allShifts = rosters.flatMap((r) => r.shift || []);
      setShifts(allShifts.filter((s) => s.shift_date >= startDate && s.shift_date <= endDate));

      // 3. Existing monthly-hours-used / remaining figures — same endpoint the rest of the app uses.
      await refreshCapacity(storeId, startDate);
    } catch (err) {
      setError(err.message || "Auto Generate failed.");
      setShifts([]);
      setResult(null);
      setCapacity(null);
    } finally {
      setLoading(false);
    }
  };

  const saveActualHours = async () => {
    setSavingActualHours(true);
    setError("");
    try {
      // Sends each entered day to the existing POST /roster/actual-hours (upserts by store+date) —
      // the deduction from monthly capacity happens entirely inside computeMonthlyCapacity on the backend.
      for (const d of dates) {
        const raw = actualHoursInput[d];
        if (raw === undefined || raw === "") continue;
        const hours = Number(raw);
        if (Number.isNaN(hours)) continue;
        await apiPost("/roster/actual-hours", { storeId, date: d, actualHours: hours });
      }
      await refreshCapacity(storeId, startDate);
    } catch (err) {
      setError(err.message || "Failed to save actual hours.");
    } finally {
      setSavingActualHours(false);
    }
  };

  const dates = startDate && endDate && startDate <= endDate ? datesInRange(startDate, endDate) : [];

  const employees = [];
  const seenEmployeeIds = new Set();
  for (const s of shifts) {
    if (s.employee && !seenEmployeeIds.has(s.employee_id)) {
      seenEmployeeIds.add(s.employee_id);
      employees.push(s.employee);
    }
  }
  employees.sort((a, b) => `${a.first_name || ""} ${a.last_name || ""}`.localeCompare(`${b.first_name || ""} ${b.last_name || ""}`));

  const shiftFor = (employeeId, date) => shifts.find((s) => s.employee_id === employeeId && s.shift_date === date) || null;

  return (
    <div>
      <Card
        title="Auto Generate Roster (Test View)"
        icon={CalendarDays}
        right={
          <Btn icon={loading ? RefreshCcw : Wand2} onClick={runAutoGenerate} disabled={loading}>
            {loading ? "Generating..." : "Auto Generate"}
          </Btn>
        }
      >
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
          Test/visualization only — calls the real <code>POST /api/roster/auto-generate</code> and renders exactly
          what the backend returns. No scheduling rules run in the browser.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input placeholder="Store ID (e.g. 1001)" value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ ...inp, width: 160 }} />
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inp} />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inp} />
          <label style={{ fontSize: 12, color: "#475569", display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={regenerate} onChange={(e) => setRegenerate(e.target.checked)} />
            regenerate
          </label>
        </div>
        {error && <div style={{ color: "#dc2626", fontSize: 12, marginTop: 10 }}>{error}</div>}
        {result && !error && (
          <div style={{ color: "#16a34a", fontSize: 12, marginTop: 10 }}>
            Generated {result.generatedShifts} shift(s), {result.totalLaborHours}h total labor, validation status: {result.validation?.status}.
          </div>
        )}
      </Card>

      {capacity && (
        <Card title="Monthly Labor Hours (existing capacity endpoint)" icon={Clock}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <KpiTile
              label="Monthly Guideline"
              value={capacity.monthlyGuideline != null ? `${capacity.monthlyGuideline} ชม.` : "ยังไม่ตั้งค่า"}
            />
            <KpiTile label="ใช้ไปแล้ว (Used/Committed)" value={`${capacity.hoursUsedOrCommitted} ชม.`} />
            <KpiTile
              label="คงเหลือ (Remaining)"
              value={capacity.remainingHours != null ? `${capacity.remainingHours} ชม.` : "-"}
              tone={capacity.remainingHours != null ? (capacity.remainingHours < 0 ? "danger" : "good") : "default"}
            />
          </div>
        </Card>
      )}

      {dates.length > 0 && (
        <Card title="Staff Roster">
          <div style={{ overflowX: "auto" }}>
            <div style={{ maxHeight: 520, overflowY: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ ...th, position: "sticky", left: 0, background: "#f8fafc", minWidth: 160, zIndex: 1 }}>STAFF NAME</th>
                    {dates.map((d) => (
                      <th key={d} style={{ ...th, minWidth: 130, textAlign: "center" }}>
                        <div>{weekdayLabel(d)}</div>
                        <div style={{ fontWeight: 400, color: "#94a3b8" }}>{d.slice(5)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => (
                    <tr key={emp.id}>
                      <td style={{ ...td, position: "sticky", left: 0, background: "#fff", verticalAlign: "top" }}>
                        <div style={{ fontWeight: 700 }}>
                          {emp.first_name} {emp.last_name}
                        </div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>
                          {emp.position ? `(${emp.position})` : ""} {employeeTypeLabel(emp) !== "-" ? `· (${employeeTypeLabel(emp)})` : ""}
                        </div>
                      </td>
                      {dates.map((d) => (
                        <td key={d} style={{ ...td, textAlign: "center", verticalAlign: "top" }}>
                          <ShiftCell shift={shiftFor(emp.id, d)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                  {employees.length === 0 && (
                    <tr>
                      <td colSpan={dates.length + 1} style={{ ...td, textAlign: "center", color: "#94a3b8", padding: 24 }}>
                        No shifts for this range yet — click Auto Generate.
                      </td>
                    </tr>
                  )}
                  {employees.length > 0 && (
                    <tr>
                      <td style={{ ...td, position: "sticky", left: 0, background: "#fffbeb", fontWeight: 700, fontSize: 11 }}>
                        Actual Hours
                        <div style={{ fontWeight: 400, color: "#92400e" }}>(store manager input)</div>
                      </td>
                      {dates.map((d) => (
                        <td key={d} style={{ ...td, textAlign: "center", background: "#fffbeb" }}>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={actualHoursInput[d] ?? ""}
                            onChange={(e) => setActualHoursInput((prev) => ({ ...prev, [d]: e.target.value }))}
                            style={{ ...inp, width: 64, padding: "4px 6px", textAlign: "center" }}
                          />
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {employees.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
              <Btn variant="outline" onClick={saveActualHours} disabled={savingActualHours}>
                {savingActualHours ? "Saving..." : "Save Actual Hours"}
              </Btn>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
