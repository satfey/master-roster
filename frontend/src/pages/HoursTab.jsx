import React from "react";
import * as XLSX from "xlsx";
import { UploadCloud } from "lucide-react";
import { Card, KpiTile, Btn, th, td, inp } from "../components/ui.jsx";
import { monthDates, fmtNum, excelDateToStr } from "../lib/calc.js";

export default function HoursTab({ role, month, employees, actual, guidelineHours, onActualChange }) {
  const editable = role === "store_manager";
  const dates = monthDates(month);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target.result, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
      const next = { ...actual };
      rows.forEach((row) => {
        const keys = Object.keys(row);
        const dateKey = keys.find((k) => /date|วันที่/i.test(k));
        const nameKey = keys.find((k) => /name|ชื่อ|employee/i.test(k));
        const hoursKey = keys.find((k) => /hour|ชั่วโมง/i.test(k));
        if (!dateKey || !nameKey || !hoursKey) return;
        const d = excelDateToStr(row[dateKey]);
        const emp = employees.find((e) => e.name === String(row[nameKey]).trim());
        const h = Number(row[hoursKey]);
        if (d && emp && !isNaN(h)) {
          next[d] = { ...(next[d] || {}), [emp.id]: h };
        }
      });
      onActualChange(next);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const totalActualHours = Object.values(actual).reduce((sum, dayMap) => sum + Object.values(dayMap || {}).reduce((a, b) => a + b, 0), 0);
  const remaining = guidelineHours - totalActualHours;

  return (
    <div>
      <Card
        title="นำเข้าชั่วโมงทำงานจริง (Excel Import)"
        icon={UploadCloud}
        right={
          editable && (
            <label>
              <Btn variant="outline" icon={UploadCloud} onClick={() => document.getElementById("hours-file-input").click()}>อัปโหลดไฟล์</Btn>
              <input id="hours-file-input" type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: "none" }} />
            </label>
          )
        }
      >
        <div style={{ fontSize: 13, color: "#64748b" }}>
          ไฟล์ควรมีคอลัมน์ <b>date/วันที่</b>, <b>name/ชื่อ</b>, <b>hours/ชั่วโมง</b>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
          <KpiTile label="ชั่วโมงตามไกด์ไลน์" value={`${fmtNum(guidelineHours)} ชม.`} />
          <KpiTile label="ใช้ไปแล้ว" value={`${fmtNum(totalActualHours)} ชม.`} tone={remaining < 0 ? "danger" : "good"} />
          <KpiTile
            label="คงเหลือ"
            value={`${fmtNum(remaining)} ชม.`}
            tone={remaining < 0 ? "danger" : "default"}
            sub={remaining < 0 ? "เกินไกด์ไลน์แล้ว" : "ยังอยู่ในกรอบ"}
          />
        </div>
      </Card>

      <Card title="บันทึกชั่วโมงทำงานจริงรายวัน">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={th}>วันที่</th>
                {employees.map((e) => (
                  <th key={e.id} style={th}>{e.name}</th>
                ))}
                <th style={th}>รวม</th>
              </tr>
            </thead>
            <tbody>
              {dates.map((d) => {
                const dayMap = actual[d] || {};
                const sum = Object.values(dayMap).reduce((a, b) => a + b, 0);
                return (
                  <tr key={d}>
                    <td style={td}>{d}</td>
                    {employees.map((e) => (
                      <td style={td} key={e.id}>
                        <input
                          type="number"
                          disabled={!editable}
                          value={dayMap[e.id] ?? ""}
                          onChange={(ev) => {
                            const v = ev.target.value === "" ? undefined : Number(ev.target.value);
                            const nextDay = { ...dayMap };
                            if (v === undefined) delete nextDay[e.id];
                            else nextDay[e.id] = v;
                            onActualChange({ ...actual, [d]: nextDay });
                          }}
                          style={{ ...inp, width: 60, padding: "4px 6px" }}
                        />
                      </td>
                    ))}
                    <td style={{ ...td, fontWeight: 700 }}>{fmtNum(sum)}</td>
                  </tr>
                );
              })}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={2} style={{ ...td, color: "#94a3b8", textAlign: "center", padding: 20 }}>
                    ยังไม่มีพนักงานในสาขานี้
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
