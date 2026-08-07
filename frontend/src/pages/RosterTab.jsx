import React, { useState } from "react";
import { Users, CalendarDays, RefreshCcw, ClipboardCheck, PlusCircle, Trash2 } from "lucide-react";
import { Card, KpiTile, Btn, Select, Badge, th, td, inp } from "../components/ui.jsx";
import { monthDates, thaiWeekday, fmtNum } from "../lib/calc.js";

export default function RosterTab({ role, month, employees, schedule, onEmployeesChange, onGenerate, onSubmit }) {
  const editable = role === "store_manager";
  const [form, setForm] = useState({ name: "", position: "พนักงานประจำ", rate: 60, maxWeek: 48, maxDay: 8 });

  const addEmployee = () => {
    if (!form.name.trim()) return;
    const id = "e" + Date.now();
    onEmployeesChange([...employees, { id, ...form, rate: Number(form.rate), maxWeek: Number(form.maxWeek), maxDay: Number(form.maxDay) }]);
    setForm({ name: "", position: "พนักงานประจำ", rate: 60, maxWeek: 48, maxDay: 8 });
  };
  const removeEmployee = (id) => onEmployeesChange(employees.filter((e) => e.id !== id));

  const dates = monthDates(month);
  const totalScheduledHours = schedule ? Object.values(schedule.shifts).reduce((a, arr) => a + arr.reduce((s, x) => s + x.hours, 0), 0) : 0;
  const over = schedule ? totalScheduledHours - schedule.totalGuidelineHours : 0;

  return (
    <div>
      {editable && (
        <Card title="พนักงานในสาขา (Roster Management)" icon={Users}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <input placeholder="ชื่อพนักงาน" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inp} />
            <Select
              value={form.position}
              onChange={(v) => setForm({ ...form, position: v })}
              options={[
                { value: "พนักงานประจำ", label: "พนักงานประจำ" },
                { value: "พาร์ทไทม์", label: "พาร์ทไทม์" },
              ]}
            />
            <input type="number" placeholder="ค่าแรง/ชม." value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} style={{ ...inp, width: 110 }} />
            <input type="number" placeholder="ชม.สูงสุด/สัปดาห์" value={form.maxWeek} onChange={(e) => setForm({ ...form, maxWeek: e.target.value })} style={{ ...inp, width: 130 }} />
            <input type="number" placeholder="ชม.สูงสุด/วัน" value={form.maxDay} onChange={(e) => setForm({ ...form, maxDay: e.target.value })} style={{ ...inp, width: 110 }} />
            <Btn icon={PlusCircle} onClick={addEmployee}>เพิ่มพนักงาน</Btn>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>ชื่อ</th>
                <th style={th}>ตำแหน่ง</th>
                <th style={th}>ค่าแรง/ชม.</th>
                <th style={th}>Max/สัปดาห์</th>
                <th style={th}>Max/วัน</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td style={td}>{e.name}</td>
                  <td style={td}>{e.position}</td>
                  <td style={td}>฿{fmtNum(e.rate)}</td>
                  <td style={td}>{e.maxWeek}</td>
                  <td style={td}>{e.maxDay}</td>
                  <td style={td}>
                    <Btn small variant="danger" icon={Trash2} onClick={() => removeEmployee(e.id)}>ลบ</Btn>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...td, color: "#94a3b8", textAlign: "center", padding: 20 }}>
                    ยังไม่มีพนักงาน กรุณาเพิ่มก่อนสร้างตารางกะ
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      <Card
        title="สร้างตารางกะอัตโนมัติ (Generate Schedule)"
        icon={CalendarDays}
        right={
          editable && (
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="outline" icon={RefreshCcw} onClick={onGenerate} disabled={employees.length === 0}>สร้าง / สร้างใหม่</Btn>
              {schedule && schedule.status === "draft" && (
                <Btn icon={ClipboardCheck} onClick={onSubmit}>ส่งขออนุมัติ</Btn>
              )}
            </div>
          )
        }
      >
        {!schedule ? (
          <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: 20 }}>ยังไม่ได้สร้างตารางกะสำหรับเดือนนี้</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
              <Badge status={schedule.status} />
              <KpiTile label="ชั่วโมงตามไกด์ไลน์" value={`${fmtNum(schedule.totalGuidelineHours)} ชม.`} />
              <KpiTile
                label="ชั่วโมงที่จัดกะไว้"
                value={`${fmtNum(totalScheduledHours)} ชม.`}
                tone={over > 0 ? "danger" : "good"}
                sub={over > 0 ? `เกินไกด์ไลน์ ${fmtNum(over)} ชม.` : "อยู่ในกรอบไกด์ไลน์"}
              />
              {schedule.comment && <div style={{ fontSize: 12, color: "#b91c1c" }}>ความเห็น Area Coach: {schedule.comment}</div>}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={th}>วันที่</th>
                    <th style={th}>งบชั่วโมง (วัน)</th>
                    <th style={th}>พนักงานที่จัดกะ (ชั่วโมง)</th>
                    <th style={th}>รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {dates.map((d) => {
                    const shifts = schedule.shifts[d] || [];
                    const sum = shifts.reduce((a, s) => a + s.hours, 0);
                    return (
                      <tr key={d}>
                        <td style={td}>{d} ({thaiWeekday(d)})</td>
                        <td style={td}>{fmtNum(schedule.dailyBudget[d])}</td>
                        <td style={td}>
                          {shifts.length === 0 ? (
                            <span style={{ color: "#cbd5e1" }}>-</span>
                          ) : (
                            shifts.map((s) => {
                              const emp = employees.find((e) => e.id === s.empId);
                              return (
                                <span key={s.empId} style={{ marginRight: 10 }}>
                                  {emp ? emp.name : "?"} ({s.hours} ชม.)
                                </span>
                              );
                            })
                          )}
                        </td>
                        <td style={{ ...td, fontWeight: 700, color: sum > schedule.dailyBudget[d] ? "#dc2626" : "#1e293b" }}>{fmtNum(sum)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
