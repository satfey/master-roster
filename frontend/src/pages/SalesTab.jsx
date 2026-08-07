import React, { useState } from "react";
import * as XLSX from "xlsx";
import { TrendingUp, UploadCloud, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, KpiTile, Btn, th, td, inp } from "../components/ui.jsx";
import { monthDates, thaiWeekday, fmtNum, excelDateToStr } from "../lib/calc.js";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

export default function SalesTab({ role, month, sales, target, forecast, totalActualSales, guidelineHours, onSalesChange, onTargetChange }) {
  const editable = role === "store_manager";
  const dates = monthDates(month);
  const [importMsg, setImportMsg] = useState("");

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
        const newSales = { ...sales };
        let count = 0;
        rows.forEach((row) => {
          const keys = Object.keys(row);
          const dateKey = keys.find((k) => /date|วันที่/i.test(k));
          const salesKey = keys.find((k) => /sale|ยอดขาย|revenue/i.test(k));
          if (!dateKey || !salesKey) return;
          const d = excelDateToStr(row[dateKey]);
          const v = Number(row[salesKey]);
          if (d && d.startsWith(month) && !isNaN(v)) {
            newSales[d] = v;
            count++;
          }
        });
        onSalesChange(newSales);
        setImportMsg(count > 0 ? `นำเข้าสำเร็จ ${count} วัน` : "ไม่พบข้อมูลที่ตรงกับเดือนนี้ ตรวจสอบหัวคอลัมน์ (date/วันที่, sales/ยอดขาย)");
      } catch (err) {
        setImportMsg("อ่านไฟล์ไม่สำเร็จ กรุณาตรวจสอบรูปแบบไฟล์");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const missingDays = dates.filter((d) => typeof sales[d] !== "number").length;
  const anomalies = dates.filter((d, i) => {
    const prev = dates[i - 1];
    if (!prev || typeof sales[d] !== "number" || typeof sales[prev] !== "number") return false;
    return sales[prev] > 0 && Math.abs(sales[d] - sales[prev]) / sales[prev] > 1.5;
  });

  const chartData = dates.map((d) => ({
    date: d.slice(8),
    ยอดขายจริง: sales[d] ?? null,
    พยากรณ์: forecast.projected[d],
  }));

  return (
    <div>
      <Card
        title="นำเข้ายอดขาย (Excel Import)"
        icon={UploadCloud}
        right={
          editable && (
            <label style={{ cursor: "pointer" }}>
              <Btn variant="outline" icon={UploadCloud} onClick={() => document.getElementById("sales-file-input").click()}>
                อัปโหลดไฟล์ .xlsx / .csv
              </Btn>
              <input id="sales-file-input" type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: "none" }} />
            </label>
          )
        }
      >
        <div style={{ fontSize: 13, color: "#64748b" }}>
          ไฟล์ควรมีคอลัมน์ชื่อ <b>date/วันที่</b> และ <b>sales/ยอดขาย</b> — ระบบจะจับคู่เฉพาะวันที่อยู่ในเดือน {month}
        </div>
        {importMsg && <div style={{ marginTop: 8, fontSize: 13, color: "#0d9488", fontWeight: 600 }}>{importMsg}</div>}
        <div style={{ marginTop: 10, display: "flex", gap: 18, fontSize: 13 }}>
          <span style={{ color: missingDays > 0 ? "#d97706" : "#16a34a", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
            {missingDays > 0 ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
            {missingDays > 0 ? `ยังไม่บันทึก ${missingDays} วัน` : "บันทึกครบทุกวันแล้ว"}
          </span>
          {anomalies.length > 0 && (
            <span style={{ color: "#dc2626", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
              <AlertTriangle size={14} /> ยอดขายผิดปกติ {anomalies.length} วัน (เทียบวันก่อนหน้า)
            </span>
          )}
        </div>
      </Card>

      <Card title="เป้าหมายยอดขายเดือนนี้ (Sales Target)">
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="number"
            value={target || ""}
            disabled={role === "store_manager"}
            onChange={(e) => onTargetChange(Number(e.target.value))}
            placeholder="กำหนดโดย Area Coach"
            style={{ ...inp, width: 200 }}
          />
          <span style={{ fontSize: 12, color: "#94a3b8" }}>บาท / เดือน {role !== "area_coach" && role !== "executive" ? "(แก้ไขได้โดย Area Coach เท่านั้น)" : ""}</span>
        </div>
      </Card>

      <Card title="แนวโน้ม & พยากรณ์ยอดขาย" icon={TrendingUp}>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1f5" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => fmtNum(v)} />
              <Legend />
              <Line type="monotone" dataKey="ยอดขายจริง" stroke="#0d9488" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
              <Line type="monotone" dataKey="พยากรณ์" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
          <KpiTile label="ยอดขายสะสม (จริง)" value={`฿${fmtNum(totalActualSales)}`} />
          <KpiTile label="พยากรณ์ยอดขายรวมทั้งเดือน" value={`฿${fmtNum(Object.values(forecast.projected).reduce((a, b) => a + b, 0))}`} tone="warn" />
          <KpiTile label="ชั่วโมงแรงงานตามไกด์ไลน์ (ประมาณการ)" value={`${fmtNum(guidelineHours)} ชม.`} tone="good" />
        </div>
      </Card>

      <Card title="บันทึกยอดขายรายวัน (Sales Management)">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>วันที่</th>
                <th style={th}>วัน</th>
                <th style={th}>ยอดขาย (บาท)</th>
                <th style={th}>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {dates.map((d) => (
                <tr key={d}>
                  <td style={td}>{d}</td>
                  <td style={td}>{thaiWeekday(d)}</td>
                  <td style={td}>
                    <input
                      type="number"
                      value={sales[d] ?? ""}
                      disabled={!editable}
                      onChange={(e) => {
                        const v = e.target.value === "" ? undefined : Number(e.target.value);
                        const next = { ...sales };
                        if (v === undefined) delete next[d];
                        else next[d] = v;
                        onSalesChange(next);
                      }}
                      style={{ ...inp, width: 130 }}
                    />
                  </td>
                  <td style={td}>
                    {typeof sales[d] !== "number" ? (
                      <span style={{ color: "#94a3b8" }}>ยังไม่บันทึก</span>
                    ) : anomalies.includes(d) ? (
                      <span style={{ color: "#dc2626", fontWeight: 600 }}>ตรวจสอบ</span>
                    ) : (
                      <span style={{ color: "#16a34a", fontWeight: 600 }}>ผ่าน Validation</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
