import { useEffect, useState } from 'react';
import { CalendarRange, Plus, Trash2 } from 'lucide-react';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import { usePermissions } from '../../hooks/usePermissions';
import { PERMISSIONS } from '../../config/permissions';
import { apiDelete, apiGet, apiPost } from '../../lib/api.js';
import './LaborGuidelinePage.css';

const EMPTY_BAND = { min: '', max: '', maxHours: '' };

const formatBand = (min, max) => {
  const from = `฿${Number(min).toLocaleString()}`;
  return max != null ? `${from} - ฿${Number(max).toLocaleString()}` : `${from} ขึ้นไป`;
};

/**
 * The chain-wide Sales -> Labour Hours guideline.
 *
 * This is chain policy, not a store setting: it decides how many labour hours EVERY store may
 * use, so it lives on its own page rather than inside a store's Staff Management screen where a
 * Store Manager would reach it. An Area Coach may read it; only an Admin may change it. The
 * backend enforces the same split (labor_guideline:view / labor_guideline:manage).
 */
export default function LaborGuidelinePage() {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission(PERMISSIONS.MANAGE_LABOR_GUIDELINE);

  const [tiers, setTiers] = useState([]);
  const [form, setForm] = useState(EMPTY_BAND);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = () =>
    apiGet('/labor/tiers')
      .then((rows) => setTiers(rows ?? []))
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  const addTier = async () => {
    if (!form.min || !form.maxHours) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost('/labor/tiers', {
        salesMin: Number(form.min),
        salesMax: form.max ? Number(form.max) : Number.MAX_SAFE_INTEGER,
        allowedLaborHours: Number(form.maxHours),
      });
      setForm(EMPTY_BAND);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeTier = async (id) => {
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/labor/tiers/${encodeURIComponent(id)}`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <Card title="เกณฑ์ชั่วโมงแรงงานตามยอดขาย (Labor Guideline)" icon={CalendarRange}>
        <p className="guideline__hint">
          เกณฑ์นี้ใช้กับทุกสาขา เป็นเพดานชั่วโมงแรงงานที่ระบบจัดตารางใช้อ้างอิง
          {!canManage && ' — ดูได้อย่างเดียว แก้ไขได้เฉพาะผู้ดูแลระบบ (Admin)'}
        </p>

        {error && <p className="guideline__error">{error}</p>}

        {canManage && (
          <>
            <div className="guideline__form">
              <input
                type="number"
                value={form.min}
                onChange={(e) => setForm((p) => ({ ...p, min: e.target.value }))}
                placeholder="ยอดขายเริ่มต้น"
                aria-label="ยอดขายเริ่มต้น"
              />
              <input
                type="number"
                value={form.max}
                onChange={(e) => setForm((p) => ({ ...p, max: e.target.value }))}
                placeholder="ยอดขายสูงสุด (ปล่อยว่างได้)"
                aria-label="ยอดขายสูงสุด"
              />
              <input
                type="number"
                value={form.maxHours}
                onChange={(e) => setForm((p) => ({ ...p, maxHours: e.target.value }))}
                placeholder="ชั่วโมงแรงงานสูงสุด"
                aria-label="ชั่วโมงแรงงานสูงสุด"
              />
            </div>
            <div className="guideline__actions">
              <Button
                variant="outline"
                size="sm"
                icon={Plus}
                onClick={addTier}
                disabled={busy || !form.min || !form.maxHours}
              >
                {busy ? 'กำลังบันทึก…' : 'เพิ่มเกณฑ์'}
              </Button>
            </div>
          </>
        )}

        {tiers.length === 0 ? (
          <EmptyState
            icon={CalendarRange}
            title="ยังไม่มีเกณฑ์"
            description={canManage ? 'เพิ่มเกณฑ์แรกได้จากฟอร์มด้านบน' : 'ผู้ดูแลระบบยังไม่ได้ตั้งเกณฑ์'}
          />
        ) : (
          <table className="staff-table">
            <thead>
              <tr>
                <th>ยอดขาย (บาท)</th>
                <th>ชั่วโมงที่ใช้ได้สูงสุด</th>
                <th>สาขา</th>
                {canManage && <th aria-label="ลบ" />}
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => (
                <tr key={tier.id}>
                  <td>{formatBand(tier.sales_min, tier.sales_max)}</td>
                  <td>{tier.allowed_labor_hours ?? tier.weekday_labor_hours ?? '—'} ชม.</td>
                  <td>{tier.store_id ? `เฉพาะสาขา ${tier.store_id}` : 'ทุกสาขา'}</td>
                  {canManage && (
                    <td>
                      <button
                        type="button"
                        className="staff-table__delete"
                        onClick={() => removeTier(tier.id)}
                        disabled={busy}
                        aria-label={`ลบเกณฑ์ ${formatBand(tier.sales_min, tier.sales_max)}`}
                      >
                        <Trash2 size={13} />
                        ลบ
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
