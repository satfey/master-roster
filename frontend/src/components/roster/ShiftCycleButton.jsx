import { AlertTriangle } from 'lucide-react';
import { nextShiftId } from '../../config/shifts';
import { resolveShift } from '../../utils/rosterUtils';
import './ShiftCycleButton.css';

/**
 * One roster cell, one button. Each click advances the shift:
 * เช้า -> บ่าย -> เย็น -> หยุด -> เช้า
 * Times come from the employee's contract, so the same shift is shorter for a
 * part-timer than for a full-timer.
 */
export default function ShiftCycleButton({
  staffName,
  day,
  cell,
  employmentType,
  onChange,
  disabled = false,
  invalid = false
}) {
  const resolved = resolveShift(cell?.shiftId, employmentType);

  const handleClick = () => {
    if (disabled) return;
    const next = nextShiftId(cell?.shiftId ?? null);
    onChange(next ? { shiftId: next } : { shiftId: null });
  };

  const label = resolved
    ? `${staffName} ${day} กะ${resolved.label} ${resolved.from}-${resolved.to} กดเพื่อเปลี่ยนกะ`
    : `${staffName} ${day} วันหยุด กดเพื่อจัดกะ`;

  return (
    <button
      type="button"
      className={[
        'shift-btn',
        `shift-btn--${resolved ? resolved.tone : 'off'}`,
        invalid ? 'is-invalid' : '',
        disabled ? 'is-readonly' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {resolved ? (
        <>
          <span className="shift-btn__label">
            {resolved.label}
            {invalid && <AlertTriangle size={9} aria-hidden="true" />}
          </span>
          <span className="shift-btn__time">
            {resolved.from}-{resolved.to}
          </span>
          <span className="shift-btn__break">
            พัก {resolved.breakFrom}-{resolved.breakTo}
          </span>
        </>
      ) : (
        <span className="shift-btn__off">หยุด</span>
      )}
    </button>
  );
}
