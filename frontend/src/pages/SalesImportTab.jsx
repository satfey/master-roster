import React, { useRef, useState } from "react";
import { UploadCloud, FileSpreadsheet, AlertTriangle, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { Card, KpiTile, Btn, th, td } from "../components/ui.jsx";
import { uploadFile } from "../lib/api.js";

const STATUS_STYLE = {
  valid: { bg: "#dcfce7", color: "#15803d", label: "พร้อมนำเข้า" },
  invalid: { bg: "#fee2e2", color: "#b91c1c", label: "ข้อมูลไม่ถูกต้อง" },
  duplicate: { bg: "#fef3c7", color: "#b45309", label: "ข้อมูลซ้ำ" },
};

const StatusPill = ({ status }) => {
  const s = STATUS_STYLE[status] || { bg: "#f1f5f9", color: "#64748b", label: status };
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
};

const ProgressBar = ({ value }) => (
  <div style={{ background: "#eef1f5", borderRadius: 999, height: 8, overflow: "hidden" }}>
    <div style={{ width: `${value}%`, background: "#0d9488", height: "100%", transition: "width 150ms ease" }} />
  </div>
);

export default function SalesImportTab() {
  const inputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setErrorMsg("");
    setImportResult(null);
    setProgress(0);
  };

  const runPreview = async (selectedFile) => {
    setFile(selectedFile);
    setImportResult(null);
    setErrorMsg("");
    setPreview(null);
    setUploading(true);
    setProgress(0);
    try {
      const data = await uploadFile("/sales/import/preview", selectedFile, { onProgress: setProgress });
      setPreview(data);
    } catch (err) {
      setErrorMsg(err.message || "อ่านไฟล์ไม่สำเร็จ");
    } finally {
      setUploading(false);
    }
  };

  const handleFiles = (fileList) => {
    const selected = fileList?.[0];
    if (!selected) return;
    if (!/\.xlsx$/i.test(selected.name)) {
      setErrorMsg("รองรับเฉพาะไฟล์ Excel (.xlsx) เท่านั้น — กรุณาอัปโหลดไฟล์รายงานต้นฉบับ");
      return;
    }
    runPreview(selected);
  };

  const confirmImport = async () => {
    if (!file) return;
    setImporting(true);
    setErrorMsg("");
    setProgress(0);
    try {
      const data = await uploadFile("/sales/import", file, { onProgress: setProgress });
      setImportResult(data);
      setPreview(null);
    } catch (err) {
      setErrorMsg(err.message || "นำเข้าข้อมูลไม่สำเร็จ");
    } finally {
      setImporting(false);
    }
  };

  const rows = preview?.rows || [];

  return (
    <div>
      <Card title="นำเข้ายอดขาย (Sales Import)" icon={UploadCloud}>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragActive ? "#0d9488" : "#cbd5e1"}`,
            borderRadius: 14,
            padding: "36px 20px",
            textAlign: "center",
            cursor: "pointer",
            background: dragActive ? "#f0fdfa" : "#f8fafc",
            transition: "all 120ms ease",
          }}
        >
          <FileSpreadsheet size={28} color="#0d9488" style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>ลากไฟล์ Excel มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
            รองรับไฟล์รายงานยอดขายต้นฉบับ (.xlsx) — ไม่ต้องแปลงเป็น CSV ระบบจะค้นหาตารางข้อมูลยอดขายให้อัตโนมัติ
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            onChange={(e) => handleFiles(e.target.files)}
            style={{ display: "none" }}
          />
        </div>

        {file && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, fontSize: 13 }}>
            <span style={{ color: "#475569" }}>
              ไฟล์ที่เลือก: <b>{file.name}</b>
            </span>
            <Btn small variant="ghost" icon={RotateCcw} onClick={reset}>เลือกไฟล์ใหม่</Btn>
          </div>
        )}

        {(uploading || importing) && (
          <div style={{ marginTop: 14 }}>
            <ProgressBar value={progress} />
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
              {uploading ? "กำลังอ่านและตรวจสอบไฟล์..." : "กำลังนำเข้าข้อมูล..."} {progress}%
            </div>
          </div>
        )}

        {errorMsg && (
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 6, color: "#dc2626", fontSize: 13, fontWeight: 600 }}>
            <AlertTriangle size={15} /> {errorMsg}
          </div>
        )}
      </Card>

      {preview && (
        <Card
          title="ตรวจสอบข้อมูลก่อนนำเข้า (Preview)"
          right={
            <Btn icon={CheckCircle2} onClick={confirmImport} disabled={importing || preview.validRows === 0}>
              ยืนยันนำเข้า {preview.validRows} รายการ
            </Btn>
          }
        >
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <KpiTile label="จำนวนแถวทั้งหมด" value={preview.totalRows} />
            <KpiTile label="พร้อมนำเข้า" value={preview.validRows} tone="good" />
            <KpiTile label="ข้อมูลไม่ถูกต้อง" value={preview.invalidRows} tone="danger" />
            <KpiTile label="ข้อมูลซ้ำ" value={preview.duplicateRows} tone="warn" />
          </div>

          <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>แถว</th>
                  <th style={th}>รหัสสาขา</th>
                  <th style={th}>ชื่อสาขา</th>
                  <th style={th}>วันที่</th>
                  <th style={th}>ยอดขาย</th>
                  <th style={th}>Docket</th>
                  <th style={th}>ชม.แรงงาน</th>
                  <th style={th}>สถานะ</th>
                  <th style={th}>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowNumber}>
                    <td style={td}>{r.rowNumber}</td>
                    <td style={td}>{r.storeCode || "-"}</td>
                    <td style={td}>{r.storeName || "-"}</td>
                    <td style={td}>{r.salesDate || "-"}</td>
                    <td style={td}>{r.salesAmount ?? "-"}</td>
                    <td style={td}>{r.docket ?? "-"}</td>
                    <td style={td}>{r.labourHours ?? "-"}</td>
                    <td style={td}>
                      <StatusPill status={r.status} />
                    </td>
                    <td style={{ ...td, color: "#dc2626", fontSize: 12 }}>{r.errors?.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {importResult && (
        <Card title="ผลการนำเข้าข้อมูล (Import Result)" icon={CheckCircle2}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <KpiTile label="นำเข้าสำเร็จ" value={importResult.imported} tone="good" />
            <KpiTile label="ข้ามเพราะซ้ำ" value={importResult.skippedDuplicates} tone="warn" />
            <KpiTile label="นำเข้าไม่สำเร็จ" value={importResult.failed?.length || 0} tone="danger" />
          </div>

          {importResult.failed?.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={th}>แถว</th>
                    <th style={th}>รหัสสาขา</th>
                    <th style={th}>สาเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {importResult.failed.map((f) => (
                    <tr key={f.rowNumber}>
                      <td style={td}>{f.rowNumber}</td>
                      <td style={td}>{f.storeCode || "-"}</td>
                      <td style={{ ...td, color: "#dc2626" }}>
                        <XCircle size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
                        {f.errors?.join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <Btn variant="outline" icon={RotateCcw} onClick={reset}>นำเข้าไฟล์อื่น</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}
