import { useState } from 'react';
import ShiftCellEditor from './ShiftCellEditor';
import { getEmploymentType } from '../../config/employmentTypes';
import { getShift } from '../../config/shifts';
import { staffWeeklyHours } from '../../utils/rosterUtils';
import { violationDaysForStaff } from '../../lib/rosterValidationAdapter.js';
import './RosterGrid.css';

/**
 * The schedule grid.
 *
 * Rows are labelled by POSITION, not by person — the published roster shows
 * what each slot is, not who is named to it. Who actually covers a shift is set
 * per cell through the editor, and is the only thing a manager can change here:
 * the hours come from the generator and the backend cannot alter them.
 *
 * staffResults comes from the backend's own validation (POST /roster/validate),
 * so a highlighted cell is a rule the generator is actually held to — not a
 * second opinion re-derived in the browser.
 */
export default function RosterGrid({ days, staff, readOnly = false, staffResults = [], assignments = {}, onAssign }) {
  const [editing, setEditing] = useState(null); // `${staffId}|${day}`

  return (
    <div className="scroll-x">
      <table className="roster-grid">
        <thead>
          <tr>
            <th className="roster-grid__staff-col">ตำแหน่ง</th>
            {days.map((day) => (
              <th key={day}>{day}</th>
            ))}
            <th className="roster-grid__total-col">รวม</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((member) => {
            const type = getEmploymentType(member.employmentType);
            const weekly = staffWeeklyHours(member, days);
            const badDays = violationDaysForStaff(staffResults, member.id);

            return (
              <tr key={member.id}>
                <th scope="row" className="roster-grid__staff-col">
                  <span className="roster-grid__name">{member.positionLabel ?? member.position}</span>
                  <span className={`roster-grid__type roster-grid__type--${type.id.toLowerCase()}`}>
                    {type.short}
                  </span>
                </th>

                {days.map((day) => {
                  const cell = member.shifts[day];
                  const key = `${member.id}|${day}`;
                  const shift = getShift(cell?.shiftId);
                  const assignedId = assignments[cell?.rosterShiftId] ?? member.id;
                  const assigned = staff.find((s) => s.id === assignedId);

                  return (
                    <td key={day} className="roster-grid__cell">
                      <button
                        type="button"
                        className={`roster-grid__slot${shift ? ` is-${shift.tone}` : ' is-off'}${badDays.has(day) ? ' is-invalid' : ''}`}
                        disabled={readOnly || !cell?.rosterShiftId}
                        onClick={() => setEditing(editing === key ? null : key)}
                      >
                        {shift ? (
                          <>
                            <span className="roster-grid__slot-time">
                              {cell.startTime && cell.endTime ? `${cell.startTime}-${cell.endTime}` : '—'}
                            </span>
                            <span className="roster-grid__slot-who">{assigned ? assigned.name : 'ยังไม่ระบุ'}</span>
                          </>
                        ) : (
                          <span className="roster-grid__slot-time">—</span>
                        )}
                      </button>

                      {editing === key && (
                        <ShiftCellEditor
                          cell={cell}
                          staff={staff}
                          currentStaffId={assignedId}
                          onAssign={(nextStaffId) => {
                            onAssign?.(cell.rosterShiftId, nextStaffId);
                            setEditing(null);
                          }}
                          onClose={() => setEditing(null)}
                        />
                      )}
                    </td>
                  );
                })}

                <td className="roster-grid__total">{weekly}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="roster-grid__daytotals">
            <th scope="row" className="roster-grid__staff-col">รวมต่อวัน</th>
            {days.map((day) => {
              const hours = staff.reduce((sum, member) => sum + (member.shifts[day]?.plannedHours ?? 0), 0);
              return <td key={day}>{hours || '—'}</td>;
            })}
            <td className="roster-grid__total">
              {staff.reduce((sum, member) => sum + days.reduce((d, day) => d + (member.shifts[day]?.plannedHours ?? 0), 0), 0)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
