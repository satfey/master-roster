import React, { useState, useEffect, useMemo } from "react";
import { TrendingUp, Clock, Store } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card, KpiTile, inp } from "../components/ui.jsx";
import { apiGet } from "../lib/api.js";
import { loadKey, saveKey } from "../lib/storage.js";
import { fetchStoreOptions, fetchForecastPreview, fetchHourlyForecastPreview, summarizeForecast } from "../lib/salesForecast.js";
import { lockedStoreId } from "../lib/storeAccess.js";

/**
 * Real sales forecast, store by store — pick a store, see the daily forecast as a chart. Calls
 * the read-only GET /forecast/preview (never POST /forecast/hourly, which persists a new
 * forecast_model_run + sales_forecast rows every call) — browsing stores here never writes
 * anything, no matter how many times a store or date range is changed.
 *
 * computeDailyForecast on the backend is the SAME function the Auto Roster generator itself
 * calls — this page never re-derives or approximates a forecast value client-side.
 */

const LAST_QUERY_KEY = "salesForecastTab:lastQuery";

function defaultRange() {
  // Defaults to next calendar month — a clean forward-looking window that won't collide with a
  // month someone has already generated a roster/forecast for.
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() + 1);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  const toISO = (d) => d.toISOString().slice(0, 10);
  return { startDate: toISO(start), endDate: toISO(end) };
}

function fmtBaht(n) {
  return `฿${Math.round(n).toLocaleString()}`;
}

function fmtDay(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

function fmtHour(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 12, boxShadow: "0 2px 8px rgba(15,23,42,0.12)" }}>
      <div style={{ color: "#64748b", marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 700, color: "#0d9488" }}>{fmtBaht(payload[0].value)}</div>
    </div>
  );
}

export default function SalesForecastTab({ user }) {
  // A user pinned to a single store (a Store Manager) never sees a store picker — their store is
  // fixed. The backend enforces the same rule independently (storeScope), this only removes a
  // control that could never lead anywhere but a 403.
  const pinnedStoreId = lockedStoreId(user);

  const [stores, setStores] = useState([]);
  const [storesError, setStoresError] = useState("");
  const [storeSearch, setStoreSearch] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hourlyDays, setHourlyDays] = useState([]);
  const [hourlyLoading, setHourlyLoading] = useState(false);
  const [hourlyError, setHourlyError] = useState("");
  const [hourShapeSource, setHourShapeSource] = useState("");
  const [selectedHourlyDate, setSelectedHourlyDate] = useState("");

  // Loads the store picker once — GET /store is already scoped server-side to what this user is
  // allowed to see (their own store, their assigned stores, or everything for Admin/Executive).
  useEffect(() => {
    (async () => {
      try {
        const list = await fetchStoreOptions(apiGet);
        setStores(list);
      } catch (err) {
        setStoresError(err.message || "Failed to load store list.");
      }
    })();
  }, []);

  // Restores the last-viewed store/range on load (same pattern as Auto Generate Roster) so
  // switching tabs or refreshing doesn't lose what someone was looking at.
  useEffect(() => {
    (async () => {
      const saved = await loadKey(LAST_QUERY_KEY, null);
      const fallback = defaultRange();
      const start = saved?.startDate || fallback.startDate;
      const end = saved?.endDate || fallback.endDate;
      setStartDate(start);
      setEndDate(end);
      // A pinned store always wins over whatever store was last viewed — a saved id from an
      // earlier session (or another account on this browser) must never preselect a store this
      // user isn't allowed to see.
      if (pinnedStoreId) {
        setSelectedStoreId(pinnedStoreId);
        return;
      }
      if (saved?.storeId) {
        setSelectedStoreId(saved.storeId);
        setStoreSearch(saved.storeLabel || saved.storeId);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedStoreId]);

  const storeById = useMemo(() => new Map(stores.map((s) => [String(s.id), s])), [stores]);
  const labelFor = (s) => `${s.storeId ?? s.id} — ${s.name}`;
  const pinnedStore = pinnedStoreId ? storeById.get(String(pinnedStoreId)) : null;

  const runFetch = async (storeId, start, end) => {
    if (!storeId || !start || !end) return;
    setLoading(true);
    setError("");
    try {
      const result = await fetchForecastPreview(apiGet, { storeId, startDate: start, endDate: end });
      setDays(result.days);
      const store = storeById.get(String(storeId));
      await saveKey(LAST_QUERY_KEY, { storeId, storeLabel: store ? labelFor(store) : storeId, startDate: start, endDate: end });
    } catch (err) {
      setError(err.message || "Failed to load forecast.");
      setDays([]);
    } finally {
      setLoading(false);
    }
  };

  // Separate fetch (own loading/error state) so a slow or failed hourly breakdown never blocks the
  // daily chart above it — same read-only /forecast/hourly/preview, never the persisting POST.
  const runHourlyFetch = async (storeId, start, end) => {
    if (!storeId || !start || !end) return;
    setHourlyLoading(true);
    setHourlyError("");
    try {
      const result = await fetchHourlyForecastPreview(apiGet, { storeId, startDate: start, endDate: end });
      setHourlyDays(result.days);
      setHourShapeSource(result.hourShapeSource);
      setSelectedHourlyDate((prev) => (result.days.some((d) => d.date === prev) ? prev : result.days[0]?.date || ""));
    } catch (err) {
      setHourlyError(err.message || "Failed to load hourly forecast.");
      setHourlyDays([]);
    } finally {
      setHourlyLoading(false);
    }
  };

  // Re-fetches once a store is actually resolved from the typed text, or the date range changes
  // — never fires on every keystroke while someone is still typing/searching.
  useEffect(() => {
    if (selectedStoreId && startDate && endDate) {
      runFetch(selectedStoreId, startDate, endDate);
      runHourlyFetch(selectedStoreId, startDate, endDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoreId, startDate, endDate]);

  const handleStoreInput = (value) => {
    setStoreSearch(value);
    const match = stores.find((s) => labelFor(s) === value);
    if (match) setSelectedStoreId(String(match.storeId ?? match.id));
  };

  const summary = summarizeForecast(days);
  const allZero = days.length > 0 && days.every((d) => d.forecastedSales === 0);
  const chartData = days.map((d) => ({ ...d, label: fmtDay(d.date) }));

  const selectedHourlyDay = hourlyDays.find((d) => d.date === selectedHourlyDate) || null;
  const hourlyChartData = selectedHourlyDay ? selectedHourlyDay.hours.map((h) => ({ ...h, label: fmtHour(h.hour) })) : [];
  const hourShapeSourceLabel =
    { STORE_HOUR_SHAPE: "this store's own history", CHAIN_HOUR_SHAPE: "chain-wide average, no store history yet", UNIFORM_FALLBACK: "equal split, no hourly history anywhere" }[
      hourShapeSource
    ] || hourShapeSource;

  return (
    <div>
      <Card
        title="Sales Forecast"
        icon={TrendingUp}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inp} />
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inp} />
          </div>
        }
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {pinnedStoreId ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#334155" }}>
              <Store size={15} color="#0d9488" />
              <b>{pinnedStore ? labelFor(pinnedStore) : pinnedStoreId}</b>
              <span style={{ color: "#94a3b8", fontSize: 12 }}>· your store</span>
            </div>
          ) : (
            <>
              <input
                list="storeOptions"
                placeholder="Type a store name or ID…"
                value={storeSearch}
                onChange={(e) => handleStoreInput(e.target.value)}
                style={{ ...inp, width: 280 }}
              />
              <datalist id="storeOptions">
                {stores.map((s) => (
                  <option key={s.id} value={labelFor(s)} />
                ))}
              </datalist>
            </>
          )}
        </div>
        {storesError && <div style={{ color: "#dc2626", fontSize: 12, marginTop: 10 }}>{storesError}</div>}
        {error && <div style={{ color: "#dc2626", fontSize: 12, marginTop: 10 }}>{error}</div>}
      </Card>

      {!selectedStoreId && !loading && (
        <Card>
          <div style={{ textAlign: "center", color: "#94a3b8", padding: 24, fontSize: 13 }}>Pick a store above to see its sales forecast.</div>
        </Card>
      )}

      {selectedStoreId && loading && (
        <Card>
          <div style={{ textAlign: "center", color: "#94a3b8", padding: 24, fontSize: 13 }}>Loading forecast…</div>
        </Card>
      )}

      {selectedStoreId && !loading && allZero && (
        <Card>
          <div style={{ textAlign: "center", color: "#94a3b8", padding: 24, fontSize: 13 }}>
            No usable sales history for this store yet — the forecast falls back to 0 (no history).
          </div>
        </Card>
      )}

      {selectedStoreId && !loading && days.length > 0 && !allZero && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
            <KpiTile label="Forecast total, period" value={fmtBaht(summary.total)} />
            <KpiTile label="Average per day" value={fmtBaht(summary.average)} />
            <KpiTile label="Peak day" value={fmtBaht(summary.peak.forecastedSales)} sub={fmtDay(summary.peak.date)} />
            <KpiTile label="Lowest day" value={fmtBaht(summary.low.forecastedSales)} sub={fmtDay(summary.low.date)} />
          </div>

          <Card title="Daily forecasted sales">
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} interval="preserveStartEnd" tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} tickLine={false} axisLine={false} width={40} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="forecastedSales" stroke="#0d9488" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 10 }}>
              Weekday-average forecast from real sales history — the same value the Auto Roster generator uses to size hourly manpower.
            </div>
          </Card>

          <Card
            title="Hourly forecast breakdown"
            icon={Clock}
            right={
              hourlyDays.length > 0 && (
                <select value={selectedHourlyDate} onChange={(e) => setSelectedHourlyDate(e.target.value)} style={inp}>
                  {hourlyDays.map((d) => (
                    <option key={d.date} value={d.date}>
                      {fmtDay(d.date)} — {fmtBaht(d.dailyForecast)}
                    </option>
                  ))}
                </select>
              )
            }
          >
            {hourlyLoading && <div style={{ textAlign: "center", color: "#94a3b8", padding: 24, fontSize: 13 }}>Loading hourly breakdown…</div>}
            {hourlyError && <div style={{ color: "#dc2626", fontSize: 12 }}>{hourlyError}</div>}
            {!hourlyLoading && !hourlyError && selectedHourlyDay && (
              <>
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={hourlyChartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                      <CartesianGrid stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                      <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} tickLine={false} axisLine={false} width={40} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="forecastedSales" fill="#0d9488" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 10 }}>
                  {fmtDay(selectedHourlyDay.date)}'s daily forecast ({fmtBaht(selectedHourlyDay.dailyForecast)}) split across operating hours using the store's
                  historical hour-of-day shape ({hourShapeSourceLabel}) — the same split the roster generator uses to size hourly manpower.
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
