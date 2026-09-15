import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, RotateCcw, Save, Users, Zap } from 'lucide-react';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import FullPageLoader from '../../components/common/FullPageLoader';
import ChartPlaceholder from '../../components/common/ChartPlaceholder';
import ScheduleSummary from '../../components/roster/ScheduleSummary';
import RosterGrid from '../../components/roster/RosterGrid';
import DemandScheduleGrid from '../../components/roster/DemandScheduleGrid';
import LaborWarnings from '../../components/roster/LaborWarnings';
import { useAuth } from '../../hooks/useAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { useStoreScope } from '../../hooks/useStoreScope';
import { PERMISSIONS } from '../../config/permissions';
import { EMPLOYMENT_TYPE_LIST } from '../../config/employmentTypes';
import { ROSTER_STATUS_LEGEND } from '../../config/rosterDisplay';
import { buildDemandRows, totalScheduledHours } from '../../utils/rosterUtils';
import { coverageForDay } from '../../utils/storeCoverage';
import { readLastGeneratedRange, rememberGeneratedRange } from '../../lib/lastRosterRange.js';
import { generateSchedule, getRoster, saveAssignments } from '../../services/rosterService';
import './RosterPage.css';

export default function RosterPage() {
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const { selectedStoreId, selectedStore, canViewManyStores } = useStoreScope();
  const canEdit = hasPermission(PERMISSIONS.GENERATE_SCHEDULE);
  // Admin / Area Coach read the store from the context bar, a Store Manager is
  // always pinned to their own store. Either way the service re-checks scope.
  const storeId = selectedStoreId ?? user?.storeId ?? null;

  const [roster, setRoster] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // { rosterShiftId: employeeId } — pending cell reassignments, not yet saved.
  const [assignments, setAssignments] = useState({});

  // The range to schedule, and the same range the roster is read back for, so what is on screen
  // is always the range it belongs to. It opens on whatever was last generated rather than on
  // the current week: the shifts are in the database either way, but resetting to this week made
  // a roster generated for any other range look like it had been lost. Read synchronously in the
  // initializer so the first render already has the right range and only one fetch is made.
  const [{ startDate, endDate }, setRange] = useState(readLastGeneratedRange);
  const [generatedRange, setGeneratedRange] = useState(readLastGeneratedRange);
  const rangeValid = Boolean(startDate && endDate && startDate <= endDate);
  // Browsing other dates is a read-only look at another range and leaves the generated one
  // alone, so say which range that was and offer the way back.
  const viewingOtherRange = startDate !== generatedRange.startDate || endDate !== generatedRange.endDate;

  useEffect(() => {
    let active = true;
    if (!storeId || !rangeValid) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setError(null);
    getRoster(user, storeId, { startDate, endDate })
      .then((data) => {
        if (!active) return;
        setRoster(data);
        setBaseline(data);
        setAssignments({});
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [user, storeId, startDate, endDate, rangeValid]);

  const scheduledHours = useMemo(
    () => (roster ? totalScheduledHours(roster.staff, roster.days) : 0),
    [roster]
  );

  const demandRows = useMemo(
    () => (roster ? buildDemandRows(roster.staff, roster.days, roster.demandDays) : []),
    [roster]
  );

  // Compliance comes from the backend (POST /roster/validate) — the same rules
  // the generator itself was held to. Nothing here re-derives a staffing or
  // labour-law rule in the browser.
  const staffResults = roster?.validation?.staffResults ?? [];
  const storeIssues = roster?.validation?.storeIssues ?? [];

  const coverage = useMemo(
    () => (roster ? roster.days.map((day) => coverageForDay(roster.staff, day)) : []),
    [roster]
  );

  const handleAssign = useCallback((rosterShiftId, employeeId) => {
    setNotice(null);
    setAssignments((prev) => ({ ...prev, [rosterShiftId]: employeeId }));
  }, []);

  const handleGenerate = async () => {
    setBusy('generate');
    setError(null);
    setNotice(null);
    try {
      const generated = await generateSchedule(user, { storeId, range: { startDate, endDate } });
      setRoster(generated);
      setBaseline(generated);
      rememberGeneratedRange({ startDate, endDate });
      setGeneratedRange({ startDate, endDate });
      setNotice(`จัดตารางเรียบร้อย: ${startDate} ถึง ${endDate}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async () => {
    setBusy('save');
    setError(null);
    try {
      const { saved } = await saveAssignments(user, storeId, assignments, roster.shiftRosterIds);
      const fresh = await getRoster(user, storeId, { startDate, endDate });
      setRoster(fresh);
      setBaseline(fresh);
      setAssignments({});
      setNotice(`บันทึกผู้รับผิดชอบแล้ว ${saved} กะ`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleReset = () => {
    setAssignments({});
    setNotice('ยกเลิกการแก้ไขที่ยังไม่ได้บันทึก');
  };

  // Only the very first load (nothing on screen yet) takes over the whole page.
  // Changing the date range re-fetches too, but the toolbar and the roster
  // already on screen stay put — a small "กำลังอัปเดต…" note near the range
  // picker covers that instead of blanking the page out from under the user.
  if (loading && !roster) return <FullPageLoader />;

  if (error && !roster) {
    return (
      <div className="page">
        <Card>
          <EmptyState icon={CalendarDays} title="โหลดข้อมูลไม่สำเร็จ" description={error} />
        </Card>
      </div>
    );
  }

  if (!rangeValid) {
    return (
      <div className="page">
        <Card>
          <EmptyState icon={CalendarDays} title="ช่วงวันที่ไม่ถูกต้อง" description="วันเริ่มต้นต้องไม่อยู่หลังวันสิ้นสุด" />
        </Card>
      </div>
    );
  }

  // No store in scope yet (the context bar is still resolving, or the account
  // has no store assigned) — there is nothing to render a roster from.
  if (!roster) {
    return (
      <div className="page">
        <Card>
          <EmptyState icon={CalendarDays} title="ยังไม่ได้เลือกสาขา" description="เลือกสาขาจากแถบด้านบนเพื่อดูตารางพนักงาน" />
        </Card>
      </div>
    );
  }

  // No shift anywhere in the range = nothing has been generated for it yet.
  const isEmptyRange = roster.staff.every((m) => roster.days.every((d) => !m.shifts[d]?.rosterShiftId));
  const isDirty = Object.keys(assignments).length > 0;
  const blockingIssues =
    storeIssues.filter((i) => i.severity === 'error').length +
    staffResults.reduce(
      (sum, entry) => sum + entry.violations.filter((v) => v.severity === 'error').length,
      0
    );

  return (
    <div className="page roster-page">
      <ScheduleSummary quota={roster.quota} scheduled={scheduledHours} />

      {error && <p className="roster-page__error">{error}</p>}
      {notice && <p className="roster-page__notice">{notice}</p>}

      <Card>
        <div className="roster-page__toolbar">
          <div>
            <h2 className="roster-page__heading">Staff Roster (Editable Grid)</h2>
            <p className="roster-page__hint">
              {canViewManyStores && selectedStore
                ? `สาขา ${selectedStore.nameTh ?? selectedStore.name} (${selectedStore.code ?? selectedStore.id}) — `
                : ''}
            </p>
          </div>
          <div className="roster-page__range">
            <label>
              ตั้งแต่
              <input
                type="date"
                value={startDate}
                max={endDate || undefined}
                onChange={(e) => setRange((prev) => ({ ...prev, startDate: e.target.value }))}
              />
            </label>
            <label>
              ถึง
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setRange((prev) => ({ ...prev, endDate: e.target.value }))}
              />
            </label>
            {canEdit && (
              <Button
                variant="success"
                size="sm"
                icon={Zap}
                onClick={handleGenerate}
                disabled={busy !== null || !rangeValid}
              >
                {busy === 'generate' ? 'กำลังจัด…' : 'AI Generate'}
              </Button>
            )}
            {loading && <span className="roster-page__updating">กำลังอัปเดต…</span>}
          </div>
        </div>

        {viewingOtherRange && (
          <div className="roster-page__generated-range">
            <span>
              ตารางที่จัดไว้ล่าสุด: {generatedRange.startDate} ถึง {generatedRange.endDate}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setRange(generatedRange)} disabled={busy !== null}>
              กลับไปดู
            </Button>
          </div>
        )}

        <ul className="roster-page__legend">
          {EMPLOYMENT_TYPE_LIST.map((type) => (
            <li key={type.id}>
              <span className={`roster-page__swatch roster-page__swatch--${type.id.toLowerCase()}`} aria-hidden="true" />
              {type.label}
            </li>
          ))}
        </ul>

        {roster.staff.length > 0 && !isEmptyRange ? (
          <RosterGrid
            days={roster.days}
            staff={roster.staff}
            readOnly={!canEdit}
            staffResults={staffResults}
            assignments={assignments}
            onAssign={handleAssign}
          />
        ) : (
          <EmptyState
            icon={CalendarDays}
            title={roster.staff.length === 0 ? 'ยังไม่มีพนักงานในสาขา' : 'ยังไม่มีตารางในช่วงวันที่นี้'}
            description={
              roster.staff.length === 0
                ? 'เพิ่มพนักงานที่หน้า Staff Management ก่อน แล้วจึงกด AI Generate'
                : 'การเลือกช่วงวันที่เป็นการดูอย่างเดียว ยังไม่ได้จัดตาราง — กด AI Generate เพื่อให้ระบบจัดกะให้'
            }
          />
        )}

        {canEdit && (
          <div className="roster-page__actions">
            <Button
              variant="primary"
              size="sm"
              icon={Save}
              onClick={handleSave}
              disabled={!isDirty || busy !== null}
            >
              {busy === 'save' ? 'กำลังบันทึก…' : 'บันทึกผู้รับผิดชอบ'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={RotateCcw}
              onClick={handleReset}
              disabled={!isDirty || busy !== null}
            >
              ยกเลิกการแก้ไข
            </Button>
            {blockingIssues > 0 && (
              <span className="roster-page__blocked">ตารางนี้มี {blockingIssues} รายการที่ไม่ผ่านกฎ (ต้องจัดตารางใหม่จึงจะแก้ได้)</span>
            )}
          </div>
        )}
      </Card>

      <Card title="การเปิด-ปิดร้าน และจำนวนพนักงานต่อวัน" icon={Users}>
        <p className="roster-page__hint">
          ชั่วโมงที่คนไม่พอ มาจากการตรวจของระบบหลังบ้าน เทียบกับความต้องการรายชั่วโมงที่
          คำนวณจากยอดขายพยากรณ์และ target productivity ของสาขา (เวลาทำการ 09:00-22:00)
        </p>
        <div className="scroll-x">
          <table className="staff-table coverage-table">
            <thead>
              <tr>
                <th>วัน</th>
                <th>ยอดขายพยากรณ์</th>
                <th>จัดแล้ว</th>
                <th>ชม.คนไม่พอ</th>
              </tr>
            </thead>
            <tbody>
              {coverage.map((row) => {
                const sales = roster.dailySales[row.day] ?? 0;
                const hourIssues = roster.validation?.hourIssuesByDate?.[row.day] ?? { understaffed: 0 };
                return (
                  <tr key={row.day}>
                    <td>{row.day}</td>
                    <td>{sales.toLocaleString()}</td>
                    <td>{row.onDuty} คน</td>
                    <td className={hourIssues.understaffed > 0 ? 'is-bad' : 'is-good'}>
                      {hourIssues.understaffed > 0 ? `${hourIssues.understaffed} ชม.` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="ตรวจสอบเงื่อนไขการจ้างและกฎหมายแรงงาน">
        <LaborWarnings staffResults={staffResults} storeIssues={storeIssues} />
      </Card>

      <Card>
        <h2 className="roster-page__heading">Headcount Demand vs Schedule (AI Mapping)</h2>
        <p className="roster-page__hint">
          ตัวเลขคือ จัดแล้ว/ยอดขายรองรับได้ (ยอดขายพยากรณ์ ÷ target productivity) — แดง = ต่ำกว่าขั้นต่ำ, เหลือง = เกินที่ยอดขายรองรับได้, เขียว = พอดี (ชั่วโมงปิดร้านนับคนปิด 2 คนเป็นขั้นต่ำ)
        </p>
        <DemandScheduleGrid days={roster.days} rows={demandRows} legend={ROSTER_STATUS_LEGEND} />
      </Card>

      <Card title="สัดส่วนต้นทุนแรงงาน (COL) เทียบกับยอดขาย แยกตามสาขา">
        <ChartPlaceholder label="กราฟ COL" height={110} />
      </Card>
    </div>
  );
}
