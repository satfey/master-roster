// Staff Management: reads, adds, changes and removes the employees of one store through the real
// backend. Every change is written to the database — nothing here keeps a local-only copy.
//
// Who may do it is decided by the backend, not by this file: `employee:manage` (Admin, and a Store
// Manager for their own store only — storeScope / employeeScope enforce the store part).

import { apiDelete, apiGet, apiPost, apiPut } from '../lib/api.js';

/**
 * The two employment types the roster generator can schedule. The backend stores them as
 * position_time_type 'Full time' / 'Part time'; anything else is excluded from every roster, so
 * this screen offers nothing else.
 */
export const STAFF_EMPLOYMENT_TYPES = [
  { id: 'FULL_TIME', label: 'พนักงานประจำ (Full time)', timeType: 'Full time' },
  { id: 'PART_TIME', label: 'พาร์ทไทม์ (Part time)', timeType: 'Part time' },
];

/** The backend's weekly-hour cap when default_weekly_hours is not set (employeeShiftRules.DEFAULT_WEEKLY_HOURS). */
const DEFAULT_WEEKLY_HOURS = 48;

/** 'Full time' / 'Part time' (any case) -> FULL_TIME / PART_TIME; null when the type is unusable. */
export function employmentTypeOf(positionTimeType) {
  const t = String(positionTimeType ?? '').trim().toLowerCase();
  if (t.startsWith('full')) return 'FULL_TIME';
  if (t.startsWith('part')) return 'PART_TIME';
  return null;
}

/** One backend employee row -> one row of the staff table. */
export function toStaffRow(employee) {
  const localName = [employee.first_name_local, employee.last_name_local].filter(Boolean).join(' ').trim();
  const name = localName || [employee.first_name, employee.last_name].filter(Boolean).join(' ').trim() || employee.id;
  return {
    id: employee.id,
    name,
    position: employee.position || '',
    employmentType: employmentTypeOf(employee.position_time_type),
    weeklyHours: employee.default_weekly_hours != null ? Number(employee.default_weekly_hours) : DEFAULT_WEEKLY_HOURS,
  };
}

/** Validates the add form and builds the POST /employee body. Returns { errors, payload }. */
export function buildCreatePayload(storeId, form) {
  const employeeId = String(form?.employeeId ?? '').trim();
  const firstName = String(form?.firstName ?? '').trim();
  const lastName = String(form?.lastName ?? '').trim();
  const position = String(form?.position ?? '').trim();
  const type = STAFF_EMPLOYMENT_TYPES.find((t) => t.id === form?.employmentType);

  const errors = [];
  if (!storeId) errors.push('ยังไม่ได้เลือกสาขา');
  if (!employeeId) errors.push('กรุณากรอกรหัสพนักงาน');
  if (!firstName) errors.push('กรุณากรอกชื่อ');
  if (!type) errors.push('กรุณาเลือกประเภทการจ้าง');
  if (errors.length) return { errors, payload: null };

  return {
    errors: [],
    payload: {
      employeeId,
      storeId,
      firstName,
      lastName: lastName || null,
      position: position || null,
      positionTimeType: type.timeType,
    },
  };
}

export async function listEmployees(storeId) {
  const rows = await apiGet(`/employee?storeId=${encodeURIComponent(storeId)}`);
  return rows.map(toStaffRow);
}

export async function createEmployee(storeId, form) {
  const { errors, payload } = buildCreatePayload(storeId, form);
  if (errors.length) throw new Error(errors.join(' · '));
  return toStaffRow(await apiPost('/employee', payload));
}

export async function changeEmploymentType(employeeId, employmentType) {
  const type = STAFF_EMPLOYMENT_TYPES.find((t) => t.id === employmentType);
  if (!type) throw new Error('ประเภทการจ้างไม่ถูกต้อง');
  return toStaffRow(await apiPut(`/employee/${encodeURIComponent(employeeId)}`, { positionTimeType: type.timeType }));
}

/** Resolves to { deleted, deactivated, futureShiftCount } from DELETE /employee/:id. */
export async function removeEmployee(employeeId) {
  return apiDelete(`/employee/${encodeURIComponent(employeeId)}`);
}

/**
 * What to tell the manager after a removal. An employee who already has shifts cannot be deleted
 * without deleting past rosters, so the backend deactivates them instead; say so plainly, and point
 * out any future shifts that still need a regenerate.
 */
export function removalMessage(name, result) {
  if (result?.deleted) return `ลบ ${name} ออกจากระบบแล้ว`;
  const future = result?.futureShiftCount ?? 0;
  const base = `${name} มีประวัติกะในตาราง จึงปิดการใช้งานแทนการลบ (ไม่แสดงในรายชื่อและจะไม่ถูกจัดกะอีก)`;
  return future > 0 ? `${base} — ยังมีกะในอนาคต ${future} กะ ควรกด AI Generate ใหม่` : base;
}
