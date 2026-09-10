import { useState } from 'react';
import { ChevronLeft, Plus, Search, Trash2, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import { EMPLOYMENT_TYPE_LIST, getEmploymentType } from '../../config/employmentTypes';
import { useEffect } from 'react';
import { useStoreScope } from '../../hooks/useStoreScope';
import { apiGet } from '../../lib/api.js';
import './StaffManagementPage.css';

const EMPTY_STAFF = { name: '', employmentType: 'FULL_TIME', dayOff: '8' };

export default function StaffManagementPage() {
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const { selectedStoreId } = useStoreScope();
  const [staff, setStaff] = useState([]);

  // Real employees for the store in scope (GET /employee, already store-scoped
  // server-side). The list starts empty rather than showing sample people.
  useEffect(() => {
    let active = true;
    if (!selectedStoreId) return undefined;
    apiGet(`/employee?storeId=${encodeURIComponent(selectedStoreId)}`)
      .then((rows) => {
        if (!active) return;
        setStaff(
          rows.map((e) => ({
            id: e.id,
            code: e.id,
            name: [e.first_name_local, e.last_name_local].filter(Boolean).join(' ').trim()
              || [e.first_name, e.last_name].filter(Boolean).join(' ').trim()
              || e.id,
            employmentType: String(e.position_time_type || '').toLowerCase().includes('part') ? 'PART_TIME' : 'FULL_TIME',
            maxHours: e.default_weekly_hours ?? null,
            dayOff: null,
            status: e.is_active ? 'active' : 'inactive',
          }))
        );
      })
      .catch(() => active && setStaff([]));
    return () => {
      active = false;
    };
  }, [selectedStoreId]);
  const [staffForm, setStaffForm] = useState(EMPTY_STAFF);
  const [showStaffForm, setShowStaffForm] = useState(false);


  const visible = staff.filter(
    (member) =>
      member.name.toLowerCase().includes(query.toLowerCase()) ||
      member.code.toLowerCase().includes(query.toLowerCase())
  );

  // There is no per-store headcount ceiling in the backend — the old 5-person
  // cap here was invented on the frontend. How many people a store can justify
  // is decided per hour by target productivity (laborDemandService), so nothing
  // blocks adding staff on this screen.
  const atCapacity = false;

  const addStaff = () => {
    if (!staffForm.name.trim() || atCapacity) return;
    const type = getEmploymentType(staffForm.employmentType);
    setStaff((prev) => [
      ...prev,
      {
        id: `st${Date.now()}`,
        code: `A${prev.length + 1}`,
        name: staffForm.name.trim(),
        employmentType: type.id,
        maxHours: type.maxWeeklyWorkHours,
        dayOff: Number(staffForm.dayOff) || 0,
        status: 'active'
      }
    ]);
    setStaffForm(EMPTY_STAFF);
    setShowStaffForm(false);
  };

  const changeEmploymentType = (id, employmentType) =>
    setStaff((prev) =>
      prev.map((m) =>
        m.id === id
          ? { ...m, employmentType, maxHours: getEmploymentType(employmentType).maxWeeklyWorkHours }
          : m
      )
    );

  const removeStaff = (id) => setStaff((prev) => prev.filter((m) => m.id !== id));

  const updateStaffField = (id, field, value) =>
    setStaff((prev) =>
      prev.map((m) => (m.id === id ? { ...m, [field]: Number(value) || 0 } : m))
    );


  return (
    <div className="page">
      <div className="page-title-bar">
        <button
          type="button"
          className="back-button"
          onClick={() => navigate('/settings')}
          aria-label="ย้อนกลับไปหน้าตั้งค่าระบบ"
        >
          <ChevronLeft size={20} />
        </button>
        <h1>Staff Management</h1>
        <span className="spacer" />
      </div>

      <Card title="พนักงานในสาขา (Roster Management)" icon={Users}>
        <p className="staff__caption">
          จัดการรายชื่อพนักงานและประเภทการจ้าง ชั่วโมงสูงสุดต่อสัปดาห์มาจากประเภทการจ้างโดยอัตโนมัติ
        </p>
        <p className="staff__capacity">พนักงาน {staff.length} คน</p>

        <div className="staff__toolbar">
          <div className="staff__search">
            <Search size={13} aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาพนักงาน"
              aria-label="ค้นหาพนักงาน"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            icon={Plus}
            onClick={() => setShowStaffForm((prev) => !prev)}
            disabled={atCapacity}
          >
            เพิ่มพนักงาน
          </Button>
        </div>

        {showStaffForm && (
          <div className="staff__inline-form">
            <input
              value={staffForm.name}
              onChange={(e) => setStaffForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="ชื่อพนักงาน"
              aria-label="ชื่อพนักงาน"
            />
            <select
              value={staffForm.employmentType}
              onChange={(e) => setStaffForm((p) => ({ ...p, employmentType: e.target.value }))}
              aria-label="ประเภทการจ้าง"
            >
              {EMPLOYMENT_TYPE_LIST.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={staffForm.dayOff}
              onChange={(e) => setStaffForm((p) => ({ ...p, dayOff: e.target.value }))}
              placeholder="วันหยุด"
              aria-label="วันหยุดต่อเดือน"
            />
            <Button variant="primary" size="sm" onClick={addStaff} disabled={!staffForm.name.trim()}>
              บันทึก
            </Button>
          </div>
        )}

        <div className="scroll-x">
          <table className="staff-table">
            <thead>
              <tr>
                <th>ลำดับ</th>
                <th>ชื่อพนักงาน</th>
                <th>ประเภทการจ้าง</th>
                <th>ต่อกะ</th>
                <th>สูงสุด/สัปดาห์</th>
                <th>วันหยุดต่อเดือน</th>
                <th aria-label="ลบ" />
              </tr>
            </thead>
            <tbody>
              {visible.map((member) => (
                <tr key={member.id}>
                  <td>{member.code}</td>
                  <td>{member.name}</td>
                  <td>
                    <select
                      className="staff-table__input staff-table__select"
                      value={member.employmentType}
                      onChange={(e) => changeEmploymentType(member.id, e.target.value)}
                      aria-label={`ประเภทการจ้างของ ${member.name}`}
                    >
                      {EMPLOYMENT_TYPE_LIST.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="staff-table__derived">
                    {getEmploymentType(member.employmentType).workHours} + พัก{' '}
                    {getEmploymentType(member.employmentType).breakHours} ชม.
                  </td>
                  <td className="staff-table__derived">
                    {getEmploymentType(member.employmentType).maxWeeklyWorkHours} ชม.
                  </td>
                  <td>
                    <input
                      className="staff-table__input"
                      type="number"
                      value={member.dayOff}
                      onChange={(e) => updateStaffField(member.id, 'dayOff', e.target.value)}
                      aria-label={`วันหยุดของ ${member.name}`}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="staff-table__delete"
                      onClick={() => removeStaff(member.id)}
                      aria-label={`ลบ ${member.name}`}
                    >
                      <Trash2 size={13} />
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="staff-table__empty">
                    ไม่พบพนักงานที่ค้นหา
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

    </div>
  );
}
