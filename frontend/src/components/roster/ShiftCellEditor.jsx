import { useEffect, useRef, useState } from 'react';
import './ShiftCellEditor.css';

/**
 * Editor for one cell of the roster.
 *
 * Only ONE thing here is editable: which employee covers this shift. The hours
 * are shown read-only because the backend cannot change them — PUT /roster/:id
 * updates a shift's employee_id and nothing else, so start/end/planned hours
 * stay exactly as the generator produced them. Offering an hours field would
 * promise something the system can't do.
 */
export default function ShiftCellEditor({ cell, staff = [], currentStaffId, onAssign, onClose }) {
  const [selected, setSelected] = useState(currentStaffId ?? '');
  const ref = useRef(null);

  // Close on outside click / Escape, so the popover behaves like a popover.
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="shift-cell-editor" ref={ref} role="dialog" aria-label="แก้ไขผู้รับผิดชอบกะ">
      <p className="shift-cell-editor__hours">
        {cell?.startTime && cell?.endTime ? `${cell.startTime}-${cell.endTime}` : 'วันหยุด'}
        {cell?.plannedHours != null && <span>{cell.plannedHours} ชม.</span>}
      </p>

      <label className="shift-cell-editor__field">
        ผู้รับผิดชอบ
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">— ยังไม่ระบุ —</option>
          {staff.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>

      <p className="shift-cell-editor__note">เวลาและชั่วโมงกำหนดโดยระบบจัดตาราง แก้ไขไม่ได้</p>

      <div className="shift-cell-editor__actions">
        <button type="button" className="is-primary" onClick={() => onAssign(selected || null)} disabled={selected === (currentStaffId ?? '')}>
          บันทึก
        </button>
        <button type="button" onClick={onClose}>
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
