import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Store, Users, CalendarDays, TrendingUp, ClipboardCheck, LayoutDashboard, Settings, Clock, UploadCloud, Wand2 } from "lucide-react";
import { Select } from "./components/ui.jsx";
import { loadKey, saveKey } from "./lib/storage.js";
import { todayMonth, calcGuidelineHours, forecastMonth, generateSchedule } from "./lib/calc.js";
import { isAuthenticated, fetchCurrentUser, logout, onUnauthorized } from "./lib/auth.js";

import LoginPage from "./pages/LoginPage.jsx";
import SalesTab from "./pages/SalesTab.jsx";
import SalesImportTab from "./pages/SalesImportTab.jsx";
import RosterTab from "./pages/RosterTab.jsx";
import AutoRosterTab from "./pages/AutoRosterTab.jsx";
import ApproveTab from "./pages/ApproveTab.jsx";
import HoursTab from "./pages/HoursTab.jsx";
import DashboardTab from "./pages/DashboardTab.jsx";
import SettingsTab from "./pages/SettingsTab.jsx";

const ROLES = [
  { value: "store_manager", label: "Store Manager" },
  { value: "area_coach", label: "Area Coach" },
  { value: "executive", label: "ผู้บริหาร" },
];

const TABS = [
  { key: "sales", label: "ยอดขาย & พยากรณ์", icon: TrendingUp },
  { key: "salesImport", label: "นำเข้ายอดขาย (Excel)", icon: UploadCloud },
  { key: "roster", label: "จัดกะพนักงาน", icon: CalendarDays },
  { key: "autoRoster", label: "Auto Generate (Test)", icon: Wand2 },
  { key: "approve", label: "อนุมัติกะ", icon: ClipboardCheck },
  { key: "hours", label: "ชั่วโมงทำงานจริง", icon: Clock },
  { key: "dashboard", label: "Dashboard / KPI", icon: LayoutDashboard },
  { key: "settings", label: "ตั้งค่า", icon: Settings },
];

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState("store_manager");
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [month, setMonth] = useState(todayMonth());
  const [guideline, setGuideline] = useState([]);
  const [activeTab, setActiveTab] = useState("sales");

  const [salesByBranch, setSalesByBranch] = useState({});
  const [targetByBranch, setTargetByBranch] = useState({});
  const [employeesByBranch, setEmployeesByBranch] = useState({});
  const [scheduleByBranch, setScheduleByBranch] = useState({});
  const [actualByBranch, setActualByBranch] = useState({});

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

  useEffect(() => {
    (async () => {
      setLoading(true);
      let b = await loadKey("branches", null);
      if (!b) {
        b = [
          { id: "b1", name: "สาขาสยาม" },
          { id: "b2", name: "สาขาเซ็นทรัลเวิลด์" },
          { id: "b3", name: "สาขาเอกมัย" },
        ];
        await saveKey("branches", b);
      }
      let g = await loadKey("guideline", null);
      if (!g) {
        g = [
          { id: 1, min: 0, max: 300000, hours: 400 },
          { id: 2, min: 300001, max: 600000, hours: 600 },
          { id: 3, min: 600001, max: 1000000, hours: 850 },
          { id: 4, min: 1000001, max: null, hours: 1100 },
        ];
        await saveKey("guideline", g);
      }
      setBranches(b);
      setGuideline(g);
      setSelectedBranch(b[0]?.id || "");
      setLoading(false);
    })();
  }, []);

  const loadBranchMonthData = useCallback(async (branchId, ym) => {
    if (!branchId) return;
    const sales = await loadKey(`sales-${branchId}-${ym}`, {});
    const target = await loadKey(`target-${branchId}-${ym}`, 0);
    const emps = await loadKey(`employees-${branchId}`, []);
    const sched = await loadKey(`schedule-${branchId}-${ym}`, null);
    const actual = await loadKey(`actual-${branchId}-${ym}`, {});
    setSalesByBranch((p) => ({ ...p, [branchId]: sales }));
    setTargetByBranch((p) => ({ ...p, [branchId]: target }));
    setEmployeesByBranch((p) => ({ ...p, [branchId]: emps }));
    setScheduleByBranch((p) => ({ ...p, [branchId]: sched }));
    setActualByBranch((p) => ({ ...p, [branchId]: actual }));
  }, []);

  useEffect(() => {
    if (selectedBranch) loadBranchMonthData(selectedBranch, month);
  }, [selectedBranch, month, loadBranchMonthData]);

  useEffect(() => {
    if ((role === "area_coach" || role === "executive") && branches.length) {
      branches.forEach((b) => loadBranchMonthData(b.id, month));
    }
  }, [role, branches, month, loadBranchMonthData]);

  const branch = branches.find((b) => b.id === selectedBranch);
  const sales = salesByBranch[selectedBranch] || {};
  const target = targetByBranch[selectedBranch] || 0;
  const employees = employeesByBranch[selectedBranch] || [];
  const schedule = scheduleByBranch[selectedBranch] || null;
  const actual = actualByBranch[selectedBranch] || {};

  const forecast = useMemo(() => forecastMonth(month, sales), [month, sales]);
  const totalActualSales = useMemo(() => Object.values(sales).reduce((a, b) => a + (b || 0), 0), [sales]);
  const guidelineHoursForBranch = useMemo(
    () => calcGuidelineHours(forecast.projected ? Object.values(forecast.projected).reduce((a, b) => a + b, 0) : 0, guideline),
    [forecast, guideline]
  );

  const updateSales = async (branchId, ym, newSales) => {
    setSalesByBranch((p) => ({ ...p, [branchId]: newSales }));
    await saveKey(`sales-${branchId}-${ym}`, newSales);
  };
  const updateTarget = async (branchId, ym, val) => {
    setTargetByBranch((p) => ({ ...p, [branchId]: val }));
    await saveKey(`target-${branchId}-${ym}`, val);
  };
  const updateEmployees = async (branchId, list) => {
    setEmployeesByBranch((p) => ({ ...p, [branchId]: list }));
    await saveKey(`employees-${branchId}`, list);
  };
  const updateSchedule = async (branchId, ym, sched) => {
    setScheduleByBranch((p) => ({ ...p, [branchId]: sched }));
    await saveKey(`schedule-${branchId}-${ym}`, sched);
  };
  const updateActual = async (branchId, ym, obj) => {
    setActualByBranch((p) => ({ ...p, [branchId]: obj }));
    await saveKey(`actual-${branchId}-${ym}`, obj);
  };
  const updateGuideline = async (g) => {
    setGuideline(g);
    await saveKey("guideline", g);
  };
  const updateBranches = async (b) => {
    setBranches(b);
    await saveKey("branches", b);
  };

  if (!authChecked) {
    return <div style={{ padding: 40, fontSize: 14, color: "#64748b" }}>กำลังตรวจสอบสิทธิ์...</div>;
  }
  if (!authUser) {
    return <LoginPage onLoggedIn={setAuthUser} />;
  }

  if (loading) {
    return <div style={{ padding: 40, fontSize: 14, color: "#64748b" }}>กำลังโหลดข้อมูล...</div>;
  }

  const visibleTabs = role === "store_manager" ? TABS.filter((t) => t.key !== "settings") : TABS.filter((t) => t.key !== "salesImport");

  return (
    <div style={{ fontFamily: "'Segoe UI', 'Noto Sans Thai', sans-serif", background: "#f5f7fa", minHeight: "100vh", color: "#1e293b" }}>
      <div style={{ background: "#101b2d", padding: "14px 22px", display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "#0d9488", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Store size={16} color="#fff" />
          </div>
          <span style={{ color: "#fff", fontWeight: 800, fontSize: 15 }}>Master Roster</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Select
            value={role}
            onChange={(v) => {
              setRole(v);
              setActiveTab("sales");
            }}
            options={ROLES}
            style={{ background: "#1a2740", color: "#fff", border: "1px solid #2b3b57" }}
          />
          {(role === "store_manager" || role === "area_coach") && (
            <Select
              value={selectedBranch}
              onChange={setSelectedBranch}
              options={branches.map((b) => ({ value: b.id, label: role === "store_manager" ? `สาขาของฉัน: ${b.name}` : b.name }))}
              style={{ background: "#1a2740", color: "#fff", border: "1px solid #2b3b57" }}
            />
          )}
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{ background: "#1a2740", color: "#fff", border: "1px solid #2b3b57", borderRadius: 8, padding: "7px 10px", fontSize: 13 }}
          />
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
        {visibleTabs.map((t) => {
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
        {activeTab === "sales" && (
          <SalesTab
            role={role}
            month={month}
            sales={sales}
            target={target}
            forecast={forecast}
            totalActualSales={totalActualSales}
            guidelineHours={guidelineHoursForBranch}
            onSalesChange={(v) => updateSales(selectedBranch, month, v)}
            onTargetChange={(v) => updateTarget(selectedBranch, month, v)}
          />
        )}
        {activeTab === "salesImport" && <SalesImportTab />}
        {activeTab === "roster" && (
          <RosterTab
            role={role}
            month={month}
            employees={employees}
            schedule={schedule}
            onEmployeesChange={(v) => updateEmployees(selectedBranch, v)}
            onGenerate={() => {
              const sched = generateSchedule(month, sales, guideline, employees);
              updateSchedule(selectedBranch, month, sched);
            }}
            onSubmit={() => {
              if (schedule) updateSchedule(selectedBranch, month, { ...schedule, status: "submitted" });
            }}
          />
        )}
        {activeTab === "autoRoster" && <AutoRosterTab />}
        {activeTab === "approve" && (
          <ApproveTab
            role={role}
            branches={branches}
            month={month}
            scheduleByBranch={scheduleByBranch}
            selectedBranch={selectedBranch}
            onDecision={(branchId, status, comment) => {
              const s = scheduleByBranch[branchId];
              if (s) updateSchedule(branchId, month, { ...s, status, comment });
            }}
            onResubmit={() => {
              if (schedule) updateSchedule(selectedBranch, month, { ...schedule, status: "submitted" });
            }}
          />
        )}
        {activeTab === "hours" && (
          <HoursTab
            role={role}
            month={month}
            employees={employees}
            actual={actual}
            guidelineHours={guidelineHoursForBranch}
            onActualChange={(v) => updateActual(selectedBranch, month, v)}
          />
        )}
        {activeTab === "dashboard" && (
          <DashboardTab
            role={role}
            branches={branches}
            month={month}
            selectedBranch={selectedBranch}
            salesByBranch={salesByBranch}
            targetByBranch={targetByBranch}
            employeesByBranch={employeesByBranch}
            scheduleByBranch={scheduleByBranch}
            actualByBranch={actualByBranch}
            guideline={guideline}
          />
        )}
        {activeTab === "settings" && (
          <SettingsTab branches={branches} guideline={guideline} onBranchesChange={updateBranches} onGuidelineChange={updateGuideline} />
        )}
      </div>
    </div>
  );
}
