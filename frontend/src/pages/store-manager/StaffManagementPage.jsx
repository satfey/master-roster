import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, Plus, Search, Trash2, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import { useStoreScope } from '../../hooks/useStoreScope';
import {
  STAFF_EMPLOYMENT_TYPES,
  buildCreatePayload,
  changeEmploymentType,
  createEmployee,
  listEmployees,
  removalMessage,
  removeEmployee,
} from '../../services/employeeService';
import './StaffManagementPage.css';

const EMPTY_FORM = { employeeId: '', firstName: '', lastName: '', position: '', employmentType: 'FULL_TIME' };

/**
 * Staff Management — the employees of the store in scope, read from and written to the database.
 *
 * Adding, changing the employment type and removing all go straight to the backend. The route is
 * gated on MANAGE_STAFF (Admin, Store Manager); which store may be touched is enforced server-side,
 * so a Store Manager can only ever act on their own store.
 */
export default function StaffManagementPage() {
  const navigate = useNavigate();
  const { selectedStoreId, selectedStore } = useStoreScope();

  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(null); // 'new' | employee id | null
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const reload = useCallback(async () => {
    if (!selectedStoreId) {
      setStaff([]);
      return;
    }
    setLoading(true);
    try {
      setStaff(await listEmployees(selectedStoreId));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedStoreId]);

  useEffect(() => {
    setError(null);
    setNotice(null);
    setShowForm(false);
    reload();
  }, [reload]);

  const handleAdd = async () => {
    setError(null);
    setNotice(null);
    const { errors } = buildCreatePayload(selectedStoreId, form);
    if (errors.length) {
      setError(errors.join(' · '));
      return;
    }
    setBusy('new');
    try {
      const created = await createEmployee(selectedStoreId, form);
      setNotice(`เพิ่ม ${created.name} (${created.id}) เข้าสาขาแล้ว`);
      setForm(EMPTY_FORM);
      setShowForm(false);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleTypeChange = async (member, employmentType) => {
    setError(null);
    setNotice(null);
    setBusy(member.id);
    try {
      const updated = await changeEmploymentType(member.id, employmentType);
      setStaff((prev) => prev.map((m) => (m.id === member.id ? updated : m)));
      const label = STAFF_EMPLOYMENT_TYPES.find((t) => t.id === employmentType)?.label ?? employmentType;
      setNotice(`เปลี่ยน ${member.name} เป็น ${label} แล้ว`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (member) => {
    if (!window.confirm(`ลบ ${member.name} (${member.id}) ออกจากสาขา?`)) return;
    setError(null);
    setNotice(null);
    setBusy(member.id);
    try {
      const result = await removeEmployee(member.id);
      setNotice(removalMessage(member.name, result));
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const needle = query.trim().toLowerCase();
  const visible = staff.filter(
    (m) => !needle || m.name.toLowerCase().includes(needle) || String(m.id).toLowerCase().includes(needle) || m.position.toLowerCase().includes(needle)
  );
  const storeLabel = selectedStore ? `${selectedStore.nameTh ?? selectedStore.name ?? ''} (${selectedStore.code ?? selectedStore.id})`.trim() : null;

  return (
    <div className="page">
      <div className="page-title-bar">
        <button type="button" className="back-button" onClick={() => navigate('/settings')} aria-label="ย้อนกลับไปหน้าตั้งค่าระบบ">
          <ChevronLeft size={20} />
        </button>
        <h1>Staff Management</h1>
        <span className="spacer" />
      </div>

      <Card title="พนักงานในสาขา" icon={Users}>
        {!selectedStoreId ? (
          <p className="staff__caption">เลือกสาขาจากแถบด้านบนก่อน เพื่อดูและจัดการพนักงานของสาขานั้น</p>
        ) : (
          <>
            <p className="staff__caption">
              {storeLabel ? `สาขา ${storeLabel} — ` : ''}เพิ่มหรือลบพนักงานที่นี่จะบันทึกลงฐานข้อมูลทันที
            </p>
            <p className="staff__capacity">{loading ? 'กำลังโหลด…' : `พนักงาน ${staff.length} คน`}</p>

            {error && <p className="staff__message staff__message--error">{error}</p>}
            {notice && <p className="staff__message staff__message--notice">{notice}</p>}

            <div className="staff__toolbar">
              <div className="staff__search">
                <Search size={13} aria-hidden="true" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาชื่อ รหัส หรือตำแหน่ง" aria-label="ค้นหาพนักงาน" />
              </div>
              <Button variant="outline" size="sm" icon={Plus} onClick={() => setShowForm((prev) => !prev)} disabled={busy !== null}>
                เพิ่มพนักงาน
              </Button>
            </div>

            {showForm && (
              <div className="staff__inline-form">
                <input
                  value={form.employeeId}
                  onChange={(e) => setForm((p) => ({ ...p, employeeId: e.target.value }))}
                  placeholder="รหัสพนักงาน"
                  aria-label="รหัสพนักงาน"
                />
                <input
                  value={form.firstName}
                  onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))}
                  placeholder="ชื่อ"
                  aria-label="ชื่อ"
                />
                <input
                  value={form.lastName}
                  onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))}
                  placeholder="นามสกุล"
                  aria-label="นามสกุล"
                />
                <input
                  value={form.position}
                  onChange={(e) => setForm((p) => ({ ...p, position: e.target.value }))}
                  placeholder="ตำแหน่ง (เช่น Service Staff)"
                  aria-label="ตำแหน่ง"
                />
                <select value={form.employmentType} onChange={(e) => setForm((p) => ({ ...p, employmentType: e.target.value }))} aria-label="ประเภทการจ้าง">
                  {STAFF_EMPLOYMENT_TYPES.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.label}
                    </option>
                  ))}
                </select>
                <div className="staff__form-actions">
                  <Button variant="primary" size="sm" onClick={handleAdd} disabled={busy !== null}>
                    {busy === 'new' ? 'กำลังบันทึก…' : 'บันทึก'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowForm(false);
                      setForm(EMPTY_FORM);
                    }}
                    disabled={busy === 'new'}
                  >
                    ยกเลิก
                  </Button>
                </div>
              </div>
            )}

            <div className="scroll-x">
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>รหัสพนักงาน</th>
                    <th>ชื่อพนักงาน</th>
                    <th>ตำแหน่ง</th>
                    <th>ประเภทการจ้าง</th>
                    <th>สูงสุด/สัปดาห์</th>
                    <th aria-label="ลบ" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((member) => (
                    <tr key={member.id}>
                      <td>{member.id}</td>
                      <td>{member.name}</td>
                      <td>{member.position || '-'}</td>
                      <td>
                        <select
                          className="staff-table__input staff-table__select"
                          value={member.employmentType ?? ''}
                          onChange={(e) => handleTypeChange(member, e.target.value)}
                          disabled={busy !== null}
                          aria-label={`ประเภทการจ้างของ ${member.name}`}
                        >
                          {!member.employmentType && (
                            <option value="" disabled>
                              ไม่ระบุ — จะไม่ถูกจัดกะ
                            </option>
                          )}
                          {STAFF_EMPLOYMENT_TYPES.map((type) => (
                            <option key={type.id} value={type.id}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="staff-table__derived">{member.weeklyHours} ชม.</td>
                      <td>
                        <button
                          type="button"
                          className="staff-table__delete"
                          onClick={() => handleRemove(member)}
                          disabled={busy !== null}
                          aria-label={`ลบ ${member.name}`}
                        >
                          <Trash2 size={13} />
                          {busy === member.id ? 'กำลังลบ…' : 'ลบ'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!loading && visible.length === 0 && (
                    <tr>
                      <td colSpan={6} className="staff-table__empty">
                        {staff.length === 0 ? 'ยังไม่มีพนักงานในสาขานี้' : 'ไม่พบพนักงานที่ค้นหา'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
