import React, { useState, useEffect, useRef } from "react";
import { CalendarDays, Wand2, RefreshCcw, TrendingUp } from "lucide-react";
import { Card, KpiTile, Btn, th, td, inp } from "../components/ui.jsx";
import { apiGet, apiPost } from "../lib/api.js";
import { loadKey, saveKey } from "../lib/storage.js";
import { resolveRoster, forceRegenerateRoster, fetchExistingShiftsForRange } from "../lib/autoRoster.js";

/**
 * Test/visualization screen only — NOT the production roster UI.
 *
 * All scheduling (Full-time 8h + 1h break, Part-time 4-8h, opening/closing
 * coverage, weekly/monthly limits, productivity, labor budget, forecast,
 * etc.) happens entirely in the backend's rosterGenerationService. This
 * component only calls POST /api/roster/auto-generate, then fetches the
 * rosters it touched via the existing GET /roster/:id and renders exactly
 * what comes back — it never computes, guesses, or invents a shift.
 *
 * "Auto Generate" never silently overwrites an already-generated roster: it
 * first checks for existing shifts in the requested range via the existing
 * GET /roster?storeId= (reused, not a new endpoint — filtered client-side
 * to the requested date range) and just displays those if found. Only
 * "Regenerate" (a separate button, behind a confirmation) sends
 * `regenerate: true` and replaces what's there.
 *
 * The "used / remaining hours" panel and the per-day actual-hours input are
 * the same reuse: the store manager's entry is sent to the existing
 * POST /roster/actual-hours, and the totals shown (monthly guideline, hours
 * used-or-committed, remaining) come straight from the existing
 * GET /roster/capacity (computeMonthlyCapacity) — no deduction/remaining-hours
 * math happens in this component.
 */

const LAST_QUERY_KEY = "autoRosterTab:lastQuery";

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
  if (t.startsWith("full")) return "Full time";
  if (t.startsWith("part")) return "Part time";
  return "-";
}

/** Renders exactly the fields the backend returned for one shift — no derived/invented values beyond formatting. */
function ShiftCell({ shift }) {
  if (!shift) return <span style={{ color: "#cbd5e1" }}>-</span>;
  const isFullTime = employeeTypeLabel(shift.employee) === "Full time";
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

function RosterStatusBadge({ status }) {
  const map = {
    existing: { bg: "#e0f2fe", color: "#0369a1", label: "Existing roster" },
    generated: { bg: "#dcfce7", color: "#15803d", label: "Newly generated" },
  };
  const s = map[status];
  if (!s) return null;
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999 }}>{s.label}</span>
  );
}

export default function AutoRosterTab() {
  const [storeId, setStoreId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // set only right after a generate/regenerate call — never for the "existing" path
  const [rosterStatus, setRosterStatus] = useState(null); // 'existing' | 'generated' | null
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const [shifts, setShifts] = useState([]); // real shift rows fetched back from the backend
  const [actualHoursInput, setActualHoursInput] = useState({}); // date -> string, the manager's editable entry
  const [savingActualHours, setSavingActualHours] = useState(false);

  // Store Monthly Overview (Monthly Sales / Monthly Guideline / Used / Remaining) — independent
  // of the Auto Generate date range above; changing the month here only re-fetches, it never
  // triggers a roster regenerate. Kept as its own state, separate from the actual-hours prefill's
  // own GET /roster/capacity call below, which must stay tied to the roster's own month.
  const [overviewMonth, setOverviewMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [monthlyOverview, setMonthlyOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const storeIdRef = useRef(storeId);
  useEffect(() => {
    storeIdRef.current = storeId;
  }, [storeId]);

  const refreshMonthlyOverview = async (sid, monthKey) => {
    if (!sid || !monthKey) return;
    setOverviewLoading(true);
    setOverviewError("");
    try {
      const data = await apiGet(`/roster/capacity?storeId=${encodeURIComponent(sid)}&month=${monthKey}`);
      setMonthlyOverview(data);
    } catch (err) {
      setOverviewError(err.message || "Failed to load monthly overview.");
      setMonthlyOverview(null);
    } finally {
      setOverviewLoading(false);
    }
  };

  // Re-fetches only when the month selector itself changes — never on every storeId keystroke.
  useEffect(() => {
    if (storeIdRef.current) refreshMonthlyOverview(storeIdRef.current, overviewMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overviewMonth]);

  /** Re-reads the existing monthly capacity endpoint and prefills the actual-hours inputs from it — never computed locally. */
  const refreshCapacity = async (sid, anyDateInMonth) => {
    const cap = await apiGet(`/roster/capacity?storeId=${encodeURIComponent(sid)}&month=${anyDateInMonth.slice(0, 7)}`);
    const prefill = {};
    for (const d of cap.byDate) {
      if (d.actualHours != null) prefill[d.date] = String(d.actualHours);
    }
    setActualHoursInput(prefill);
  };

  /** GET-only: looks for shifts already generated for this range and, if found, displays them without ever calling the write endpoint. Returns whether it found any. */
  const checkExisting = async (sid, start, end) => {
    const existing = await fetchExistingShiftsForRange(apiGet, sid, start, end);
    if (existing.length === 0) return false;
    setShifts(existing);
    setResult(null);
    setRosterStatus("existing");
    await refreshCapacity(sid, start);
    return true;
  };

  // Restores the last store/date range the user looked at, and re-checks for
  // existing shifts (GET only — never auto-generates) so an existing roster
  // is still visible after a page refresh.
  useEffect(() => {
    (async () => {
      const saved = await loadKey(LAST_QUERY_KEY, null);
      if (!saved?.storeId || !saved?.startDate || !saved?.endDate) return;
      setStoreId(saved.storeId);
      setStartDate(saved.startDate);
      setEndDate(saved.endDate);
      setLoading(true);
      try {
        await checkExisting(saved.storeId, saved.startDate, saved.endDate);
      } catch (err) {
        setError(err.message || "Failed to load the existing roster.");
      } finally {
        setLoading(false);
      }
      refreshMonthlyOverview(saved.storeId, overviewMonth);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runCheckOrGenerate = async () => {
    if (!storeId || !startDate || !endDate) {
      setError("Enter Store ID, start date, and end date.");
      return;
    }
    setLoading(true);
    setError("");
    setConfirmingRegenerate(false);
    try {
      const { status, shifts: rows, result: genResult } = await resolveRoster({ apiGet, apiPost }, { storeId, startDate, endDate });
      setShifts(rows);
      setResult(genResult);
      setRosterStatus(status);
      await refreshCapacity(storeId, startDate);
      refreshMonthlyOverview(storeId, overviewMonth);
      await saveKey(LAST_QUERY_KEY, { storeId, startDate, endDate });
    } catch (err) {
      setError(err.message || "Auto Generate failed.");
      setShifts([]);
      setResult(null);
      setRosterStatus(null);
    } finally {
      setLoading(false);
    }
  };

  const runRegenerate = async () => {
    setLoading(true);
    setError("");
    setConfirmingRegenerate(false);
    try {
      const { status, shifts: rows, result: genResult } = await forceRegenerateRoster({ apiGet, apiPost }, { storeId, startDate, endDate });
      setShifts(rows);
      setResult(genResult);
      setRosterStatus(status);
      await refreshCapacity(storeId, startDate);
      refreshMonthlyOverview(storeId, overviewMonth);
      await saveKey(LAST_QUERY_KEY, { storeId, startDate, endDate });
    } catch (err) {
      setError(err.message || "Regenerate failed.");
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
  // Sorted by type then id — never by name, since the roster only ever displays position (Full time / Part time), not who's in it.
  employees.sort((a, b) => employeeTypeLabel(a).localeCompare(employeeTypeLabel(b)) || String(a.id).localeCompare(String(b.id)));

  const shiftFor = (employeeId, date) => shifts.find((s) => s.employee_id === employeeId && s.shift_date === date) || null;

  return (
    <div>
      <Card
        title="Auto Generate Roster (Test View)"
        icon={CalendarDays}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <RosterStatusBadge status={rosterStatus} />
            <Btn icon={loading ? RefreshCcw : Wand2} onClick={runCheckOrGenerate} disabled={loading}>
              {loading ? "Working..." : "Auto Generate"}
            </Btn>
            <Btn
              variant="danger"
              icon={RefreshCcw}
              onClick={() => setConfirmingRegenerate(true)}
              disabled={loading || !storeId || !startDate || !endDate}
            >
              Regenerate
            </Btn>
          </div>
        }
      >
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
          Test/visualization only — calls the real <code>POST /api/roster/auto-generate</code> and renders exactly
          what the backend returns. No scheduling rules run in the browser. If a roster already exists for this
          store and date range, <b>Auto Generate</b> only loads and displays it — it never overwrites. Only{" "}
          <b>Regenerate</b> (with confirmation) replaces existing shifts.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            placeholder="Store ID (e.g. 1001)"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            onBlur={() => refreshMonthlyOverview(storeId, overviewMonth)}
            style={{ ...inp, width: 160 }}
          />
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inp} />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inp} />
        </div>

        {confirmingRegenerate && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: 14, marginTop: 14 }}>
            <div style={{ color: "#991b1b", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Confirm regenerate</div>
            <div style={{ color: "#7f1d1d", fontSize: 12, marginBottom: 12 }}>
              This will <b>replace the existing roster</b> for store {storeId} between {startDate} and {endDate}. Any
              shifts already generated for this range will be deleted and replaced. This cannot be undone.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="danger" onClick={runRegenerate} disabled={loading} small>
                {loading ? "Regenerating..." : "Confirm Regenerate"}
              </Btn>
              <Btn variant="ghost" onClick={() => setConfirmingRegenerate(false)} disabled={loading} small>
                Cancel
              </Btn>
            </div>
          </div>
        )}

        {error && <div style={{ color: "#dc2626", fontSize: 12, marginTop: 10 }}>{error}</div>}
        {rosterStatus === "existing" && !error && (
          <div style={{ color: "#0369a1", fontSize: 12, marginTop: 10 }}>
            Found {shifts.length} existing shift(s) for this range — showing the roster already on file.
          </div>
        )}
        {rosterStatus === "generated" && result && !error && (
          <div style={{ color: "#16a34a", fontSize: 12, marginTop: 10 }}>
            Generated {result.generatedShifts} shift(s), {result.totalLaborHours}h total labor, validation status: {result.validation?.status}.
          </div>
        )}
      </Card>

      {storeId && (
        <Card
          title={`Store Monthly Overview — Store ${storeId}`}
          icon={TrendingUp}
          right={
            <input
              type="month"
              value={overviewMonth}
              onChange={(e) => setOverviewMonth(e.target.value)}
              style={inp}
            />
          }
        >
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
            Monthly Sales (SUM of <code>sales_report.gross_actual</code> for the month) mapped through the
            Sales → Monthly Labor Hours business table. This is a planning ceiling only — Auto Generate
            optimizes to actual demand and never pads shifts to fill it. Changing the month only re-fetches;
            it never regenerates the roster.
          </div>
          {overviewLoading && <div style={{ fontSize: 12, color: "#94a3b8" }}>Loading...</div>}
          {overviewError && <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 10 }}>{overviewError}</div>}
          {monthlyOverview && !overviewLoading && (() => {
            // Two independent guideline sources exist on this same response: monthlyGuideline
            // (labor_guideline.monthly_labor_hours — a manual per-store override, unset for every
            // store today) and monthlyGuidelineHours (computed from this month's real sales via the
            // business table). Showing both as two separate "Monthly Guideline" numbers is confusing
            // — one manual override, if a store ever has one set, always wins; otherwise fall back
            // to the sales-derived figure.
            const hasOverride = monthlyOverview.monthlyGuideline != null;
            const guidelineValue = hasOverride
              ? `${monthlyOverview.monthlyGuideline} hrs`
              : monthlyOverview.guidelineWithinRange
              ? `${monthlyOverview.monthlyGuidelineHours} hrs`
              : "Outside guideline range";
            const guidelineSub = hasOverride ? "manual override" : "from monthly sales";
            return (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <KpiTile label="Monthly Sales" value={`฿${Math.round(monthlyOverview.monthlySales).toLocaleString()}`} />
                <KpiTile
                  label="Monthly Guideline"
                  value={guidelineValue}
                  sub={guidelineSub}
                  tone={!hasOverride && !monthlyOverview.guidelineWithinRange ? "warn" : "default"}
                />
                <KpiTile label="Used" value={`${monthlyOverview.hoursUsedOrCommitted} hrs`} />
                <KpiTile
                  label="Remaining"
                  value={monthlyOverview.remainingHours != null ? `${monthlyOverview.remainingHours} hrs` : "-"}
                  tone={monthlyOverview.remainingHours != null ? (monthlyOverview.remainingHours < 0 ? "danger" : "good") : "default"}
                />
              </div>
            );
          })()}
        </Card>
      )}

      {dates.length > 0 && (
        <Card title="Staff Roster">
          <div style={{ overflowX: "auto" }}>
            <div style={{ maxHeight: 520, overflowY: "auto" }}>
              {/* Rows = day (Mon/Tue/...), columns = position — swapped from the original
                  columns-as-day layout so a typical week view is a fixed ~7 rows tall instead of
                  needing horizontal scroll; a long date range now grows tall instead of wide. */}
              <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ ...th, position: "sticky", left: 0, background: "#f8fafc", minWidth: 110, zIndex: 1 }}>DATE</th>
                    {employees.map((emp) => (
                      <th key={emp.id} style={{ ...th, minWidth: 130, textAlign: "center" }}>
                        {/* Position only — never the employee's name or job title, so nobody can tell who is scheduled for which shift from this view. */}
                        {employeeTypeLabel(emp)}
                      </th>
                    ))}
                    {employees.length > 0 && (
                      <th style={{ ...th, minWidth: 90, textAlign: "center", background: "#fffbeb" }}>
                        ACTUAL HOURS
                        <div style={{ fontWeight: 400, color: "#92400e" }}>(store manager input)</div>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {employees.length === 0 ? (
                    <tr>
                      <td style={{ ...td, textAlign: "center", color: "#94a3b8", padding: 24 }}>
                        No shifts for this range yet — click Auto Generate.
                      </td>
                    </tr>
                  ) : (
                    dates.map((d) => (
                      <tr key={d}>
                        <td style={{ ...td, position: "sticky", left: 0, background: "#fff", verticalAlign: "top" }}>
                          <div style={{ fontWeight: 700 }}>{weekdayLabel(d)}</div>
                          <div style={{ fontWeight: 400, color: "#94a3b8" }}>{d.slice(5)}</div>
                        </td>
                        {employees.map((emp) => (
                          <td key={emp.id} style={{ ...td, textAlign: "center", verticalAlign: "top" }}>
                            <ShiftCell shift={shiftFor(emp.id, d)} />
                          </td>
                        ))}
                        <td style={{ ...td, textAlign: "center", background: "#fffbeb" }}>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={actualHoursInput[d] ?? ""}
                            onChange={(e) => setActualHoursInput((prev) => ({ ...prev, [d]: e.target.value }))}
                            style={{ ...inp, width: 64, padding: "4px 6px", textAlign: "center" }}
                          />
                        </td>
                      </tr>
                    ))
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
