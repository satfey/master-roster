import React, { useEffect, useRef, useState } from "react";
import { FileSpreadsheet, AlertTriangle, CheckCircle2, XCircle, Loader2, Circle, RotateCcw, Receipt, Clock3, Users, Building2, Target } from "lucide-react";
import { Card, Btn, th, td } from "../components/ui.jsx";
import { uploadFile, apiGet } from "../lib/api.js";

/**
 * Internal test page — upload each of the 4 real Excel import endpoints
 * directly and see the actual preview/import response. Not a production
 * import UI; just lets the team try a real company file against each real
 * endpoint without going through Swagger.
 */

const ProgressBar = ({ value }) => (
  <div style={{ background: "#eef1f5", borderRadius: 999, height: 8, overflow: "hidden" }}>
    <div style={{ width: `${value}%`, background: "#0d9488", height: "100%", transition: "width 150ms ease" }} />
  </div>
);

const StatusPill = ({ status }) => {
  const map = {
    valid: { bg: "#dcfce7", color: "#15803d" },
    new: { bg: "#dcfce7", color: "#15803d" },
    update: { bg: "#dbeafe", color: "#1d4ed8" },
    invalid: { bg: "#fee2e2", color: "#b91c1c" },
    duplicate: { bg: "#fef3c7", color: "#b45309" },
    duplicate_in_file: { bg: "#fef3c7", color: "#b45309" },
  };
  const s = map[status] || { bg: "#f1f5f9", color: "#64748b" };
  return <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>{status}</span>;
};

const StatTile = ({ label, value }) => (
  <div style={{ background: "#f8fafc", borderRadius: 10, padding: "8px 12px", minWidth: 100 }}>
    <div style={{ fontSize: 11, color: "#64748b" }}>{label}</div>
    <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b" }}>{value}</div>
  </div>
);

/** Drag-drop + click-to-browse file zone, shared by every section below. */
function DropZone({ onFile, disabled }) {
  const inputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFiles = (fileList) => {
    const selected = fileList?.[0];
    if (!selected) return;
    if (!/\.xlsx$/i.test(selected.name)) return;
    onFile(selected);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragActive ? "#0d9488" : "#cbd5e1"}`,
        borderRadius: 12,
        padding: "22px 16px",
        textAlign: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        background: dragActive ? "#f0fdfa" : "#f8fafc",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <FileSpreadsheet size={22} color="#0d9488" style={{ marginBottom: 6 }} />
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>ลากไฟล์ .xlsx มาวาง หรือคลิกเพื่อเลือกไฟล์</div>
      <input ref={inputRef} type="file" accept=".xlsx" onChange={(e) => handleFiles(e.target.files)} style={{ display: "none" }} disabled={disabled} />
    </div>
  );
}

const JOB_POLL_INTERVAL_MS = 1000;

/**
 * Preview -> confirm-import flow shared by all 4 endpoints — only the paths, extra fields, and
 * table columns differ per type. Pass `{ asyncCommit: true }` for an endpoint whose commit
 * returns `{ jobId }` immediately (202) instead of the full result (see salesReportController.js)
 * — this then polls GET `${commitPath}/${jobId}/progress` for REAL status (computed server-side
 * from the actual import's real stage/elapsed time, never a client-side timer or interpolation)
 * until the job reaches "completed" or "failed". Endpoints that still respond synchronously are
 * completely unaffected — `asyncCommit` defaults to false, and `jobStatus` simply stays null.
 */
function useImportFlow(previewPath, commitPath, { asyncCommit = false } = {}) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [jobStatus, setJobStatus] = useState(null); // real server-reported job status while asyncCommit is polling
  const pollTimerRef = useRef(null);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };
  useEffect(() => stopPolling, []); // stop polling if the component unmounts mid-import

  const reset = () => {
    stopPolling();
    setFile(null);
    setPreview(null);
    setImportResult(null);
    setErrorMsg("");
    setProgress(0);
    setJobStatus(null);
  };

  const runPreview = async (selectedFile, fields) => {
    setFile(selectedFile);
    setImportResult(null);
    setErrorMsg("");
    setPreview(null);
    setUploading(true);
    setProgress(0);
    try {
      const data = await uploadFile(previewPath, selectedFile, { onProgress: setProgress, fields });
      setPreview(data);
    } catch (err) {
      setErrorMsg(err.message || "อ่านไฟล์ไม่สำเร็จ");
    } finally {
      setUploading(false);
    }
  };

  /** Polls the real job status every second until it reaches a terminal state — never fakes progress between polls. */
  const pollJob = (jobId) => {
    stopPolling();
    pollTimerRef.current = setInterval(async () => {
      try {
        const job = await apiGet(`${commitPath}/${jobId}/progress`);
        setJobStatus(job);
        if (job.status === "completed") {
          stopPolling();
          setImportResult(job.result);
          setPreview(null);
          setImporting(false);
        } else if (job.status === "failed") {
          stopPolling();
          setErrorMsg(job.error || "นำเข้าข้อมูลไม่สำเร็จ");
          setImporting(false);
        }
      } catch (err) {
        stopPolling();
        setErrorMsg(err.message || "ไม่สามารถตรวจสอบสถานะการนำเข้าได้");
        setImporting(false);
      }
    }, JOB_POLL_INTERVAL_MS);
  };

  const confirmImport = async (fields) => {
    if (!file) return;
    setImporting(true);
    setErrorMsg("");
    setProgress(0);
    setJobStatus(null);
    try {
      const data = await uploadFile(commitPath, file, { onProgress: setProgress, fields });
      if (asyncCommit) {
        // data = { jobId } — the file finished uploading, but the import itself is still
        // running server-side; importing stays true until polling reaches completed/failed.
        pollJob(data.jobId);
      } else {
        setImportResult(data);
        setPreview(null);
        setImporting(false);
      }
    } catch (err) {
      setErrorMsg(err.message || "นำเข้าข้อมูลไม่สำเร็จ");
      setImporting(false);
    }
  };

  return { file, uploading, importing, progress, preview, importResult, errorMsg, jobStatus, reset, runPreview, confirmImport };
}

const STAGE_LABELS = {
  parsing: "Reading Excel",
  transforming: "Transforming rows",
  validating: "Validating",
  database_insert: "Importing to Database",
};

/** mm:ss (or h:mm:ss past an hour) — used for elapsed/stage durations, never a countdown/estimate. */
function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Real-progress panel for an asyncCommit job (see useImportFlow) — every number here comes
 * straight from the server's job status (importJobStore, polled via GET .../progress), computed
 * from the actual import's real elapsed time and stage transitions. There is deliberately no
 * overall percentage bar: this app's Sales Report write is one atomic upsert (see
 * salesReportRepository.js), so Postgres gives no mid-statement row-count signal to compute a
 * real percent from during that stage — showing one anyway would mean guessing, which is exactly
 * what real progress must not do. Completed stages get a checkmark + how long they actually took;
 * the current stage shows its own status message and ticks up in elapsed time; a failed stage
 * shows the real error.
 */
function JobProgressPanel({ job }) {
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (job.status !== "importing") return undefined;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job.status]);

  const startedAtMs = job.startedAt ? new Date(job.startedAt).getTime() : null;
  const liveElapsedSeconds = startedAtMs ? (nowTick - startedAtMs) / 1000 : job.elapsedSeconds;

  return (
    <div style={{ background: "#f8fafc", border: "1px solid #eef1f5", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {(job.stages || []).map((s) => {
          const isCurrent = s.status === "in_progress";
          const isDone = s.status === "completed";
          const isFailed = s.status === "failed";
          const Icon = isDone ? CheckCircle2 : isFailed ? XCircle : isCurrent ? Loader2 : Circle;
          const color = isDone ? "#15803d" : isFailed ? "#dc2626" : isCurrent ? "#0d9488" : "#94a3b8";
          return (
            <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: isCurrent ? "#1e293b" : "#64748b", fontWeight: isCurrent ? 700 : 400 }}>
              <Icon size={15} color={color} style={isCurrent ? { animation: "spin 1s linear infinite" } : undefined} />
              <span>{STAGE_LABELS[s.name] || s.name}</span>
              {isDone && s.durationSeconds != null && <span style={{ color: "#94a3b8", fontSize: 11 }}>({formatDuration(s.durationSeconds)})</span>}
            </div>
          );
        })}
      </div>

      {job.status === "importing" && (
        <div style={{ fontSize: 13, color: "#1e293b" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{job.statusMessage}</div>
          {job.stageProgress ? (
            // Real, row-counted progress (currently only the database_insert stage reports this —
            // see salesReportRepository's chunked upsertRecords). Every number below comes straight
            // from the server's job status, recomputed fresh on each poll from rows actually
            // written and real elapsed time — never a client-side timer or interpolation.
            <>
              <ProgressBar value={job.stageProgress.percent} />
              <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>
                {job.stageProgress.percent}% — {job.stageProgress.processedRows.toLocaleString()} / {job.stageProgress.totalRows.toLocaleString()} rows
              </div>
              <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>
                Elapsed: {formatDuration(liveElapsedSeconds)}
                {job.stageProgress.rowsPerSecond > 0 && <> · Rate: {job.stageProgress.rowsPerSecond.toLocaleString()} rows/sec</>}
                {job.stageProgress.estimatedRemainingSeconds != null && <> · ETA: {formatDuration(job.stageProgress.estimatedRemainingSeconds)}</>}
              </div>
            </>
          ) : (
            <>
              {job.totalRows != null && <div style={{ color: "#64748b", fontSize: 12 }}>Total rows: {job.totalRows.toLocaleString()}</div>}
              <div style={{ color: "#64748b", fontSize: 12 }}>Elapsed: {formatDuration(liveElapsedSeconds)}</div>
            </>
          )}
        </div>
      )}
      {job.status === "failed" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#dc2626", fontSize: 13, fontWeight: 600 }}>
          <AlertTriangle size={14} /> {job.error}
        </div>
      )}
      {job.status === "completed" && (
        <div style={{ color: "#15803d", fontSize: 13, fontWeight: 700 }}>
          Completed in {formatDuration(job.elapsedSeconds)}
        </div>
      )}
      <style>{"@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }"}</style>
    </div>
  );
}

function SectionShell({ icon, title, description, flow, children, canConfirm = true, extraControls }) {
  const { file, uploading, importing, progress, preview, importResult, errorMsg, jobStatus, reset } = flow;
  return (
    <Card icon={icon} title={title}>
      {description && <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>{description}</div>}
      {extraControls}
      {!file && !importResult && <DropZone onFile={(f) => children.onFile(f)} disabled={uploading} />}
      {file && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, fontSize: 13 }}>
          <span style={{ color: "#475569" }}>
            ไฟล์: <b>{file.name}</b>
          </span>
          <Btn small variant="ghost" icon={RotateCcw} onClick={reset}>
            เลือกไฟล์ใหม่
          </Btn>
        </div>
      )}
      {importing && jobStatus ? (
        <div style={{ marginBottom: 10 }}>
          <JobProgressPanel job={jobStatus} />
        </div>
      ) : (
        (uploading || importing) && (
          <div style={{ marginBottom: 10 }}>
            <ProgressBar value={progress} />
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
              {uploading ? "กำลังอ่านไฟล์..." : "กำลังนำเข้า..."} {progress}%
            </div>
          </div>
        )
      )}
      {errorMsg && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#dc2626", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
          <AlertTriangle size={14} /> {errorMsg}
        </div>
      )}
      {preview && children.renderPreview(preview)}
      {preview && canConfirm && (
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <Btn icon={CheckCircle2} onClick={children.onConfirm} disabled={importing}>
            {importing ? "กำลังนำเข้า..." : "ยืนยันนำเข้าจริง"}
          </Btn>
        </div>
      )}
      {importResult && (
        <div>
          {children.renderResult(importResult)}
          <div style={{ marginTop: 10 }}>
            <Btn variant="outline" small icon={RotateCcw} onClick={reset}>
              นำเข้าไฟล์อื่น
            </Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

function RowsTable({ rows, columns }) {
  return (
    <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto", border: "1px solid #eef1f5", borderRadius: 8 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={th}>#</th>
            <th style={th}>สถานะ</th>
            {columns.map((c) => (
              <th key={c.key} style={th}>
                {c.label}
              </th>
            ))}
            <th style={th}>Errors</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rowNumber}>
              <td style={td}>{r.rowNumber}</td>
              <td style={td}>
                <StatusPill status={r.status || r.action} />
              </td>
              {columns.map((c) => (
                <td key={c.key} style={td}>
                  {c.render ? c.render(r) : String(r[c.key] ?? "-")}
                </td>
              ))}
              <td style={{ ...td, color: "#dc2626" }}>{(r.errors || []).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SalesReportSection() {
  const flow = useImportFlow("/sales/report/import/preview", "/sales/report/import", { asyncCommit: true });
  return (
    <SectionShell
      icon={Receipt}
      title="Sales Report Import"
      flow={flow}
    >
      {{
        onFile: (f) => flow.runPreview(f, {}),
        onConfirm: () => flow.confirmImport({}),
        renderPreview: (p) => (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <StatTile label="ทั้งหมด" value={p.totalRows} />
              <StatTile label="ใหม่" value={p.newRows} />
              <StatTile label="อัปเดต" value={p.updateRows} />
              <StatTile label="ไม่ถูกต้อง" value={p.invalidRows} />
              <StatTile label="ซ้ำในไฟล์" value={p.duplicateInFileRows} />
              <StatTile label="สร้างสาขาใหม่" value={p.newStoreCount} />
            </div>
            <RowsTable
              rows={p.previewRows}
              columns={[
                { key: "storeId", label: "Store ID" },
                { key: "storeName", label: "Store Name" },
                { key: "reportDate", label: "Date" },
                { key: "grossActual", label: "Gross Actual" },
                { key: "grossBudget", label: "Budget" },
              ]}
            />
          </>
        ),
        renderResult: (r) => (
          <StatusMessage>
            นำเข้า {r.imported} / {r.total} แถวสำเร็จ ({r.inserted} ใหม่, {r.updated} อัปเดต) — สร้างสาขาใหม่ {r.storesCreated?.length || 0} สาขา
          </StatusMessage>
        ),
      }}
    </SectionShell>
  );
}

function SalesByHourSection() {
  const flow = useImportFlow("/sales/by-hour/import/preview", "/sales/by-hour/import");
  const [month, setMonth] = useState("");

  return (
    <SectionShell
      icon={Clock3}
      title="Sales-by-Hour Import"
      flow={flow}
      canConfirm={!!month}
      extraControls={
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: "#475569", display: "block", marginBottom: 4 }}>Month (required)</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", fontSize: 13 }} />
        </div>
      }
    >
      {{
        onFile: (f) => month && flow.runPreview(f, { month }),
        onConfirm: () => flow.confirmImport({ month }),
        renderPreview: (p) => (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <StatTile label="ทั้งหมด" value={p.totalRows} />
              <StatTile label="ใหม่" value={p.newRows} />
              <StatTile label="อัปเดต" value={p.updateRows} />
              <StatTile label="ไม่ถูกต้อง" value={p.invalidRows} />
              <StatTile label="ซ้ำในไฟล์" value={p.duplicateInFileRows} />
              <StatTile label="สร้างสาขาใหม่" value={p.newStoreCount} />
            </div>
            <RowsTable
              rows={p.rows}
              columns={[
                { key: "storeId", label: "Store ID" },
                { key: "storeName", label: "Store Name" },
                { key: "hour", label: "Hour" },
                { key: "grossSale", label: "Gross Sale" },
              ]}
            />
          </>
        ),
        renderResult: (r) => (
          <StatusMessage>
            นำเข้า {r.imported} / {r.total} แถวสำเร็จ ({r.inserted} ใหม่, {r.updated} อัปเดต) — สร้างสาขาใหม่ {r.storesCreated?.length || 0} สาขา
          </StatusMessage>
        ),
      }}
    </SectionShell>
  );
}

function EmployeeMasterSection() {
  const flow = useImportFlow("/employee/import/preview", "/employee/import");
  return (
    <SectionShell
      icon={Users}
      title="Employee Master Import"
      flow={flow}
    >
      {{
        onFile: (f) => flow.runPreview(f, {}),
        onConfirm: () => flow.confirmImport({}),
        renderPreview: (p) => (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <StatTile label="ทั้งหมด" value={p.totalRows} />
              <StatTile label="ถูกต้อง" value={p.validRows} />
              <StatTile label="ไม่ถูกต้อง" value={p.invalidRows} />
              <StatTile label="พนักงานใหม่" value={p.newEmployeeCount} />
              <StatTile label="อัปเดต" value={p.updateEmployeeCount} />
              <StatTile label="ไม่เปลี่ยนแปลง" value={p.unchangedEmployeeCount} />
            </div>
            <RowsTable
              rows={p.rows}
              columns={[
                { key: "employeeId", label: "Employee ID" },
                { key: "firstName", label: "First Name" },
                { key: "lastName", label: "Last Name" },
                { key: "storeName", label: "Location" },
                { key: "resolvedStoreId", label: "Resolved Store ID" },
              ]}
            />
          </>
        ),
        renderResult: (r) => (
          <StatusMessage>
            สร้างใหม่ {r.created} คน, อัปเดต {r.updated} คน, ไม่เปลี่ยนแปลง {r.unchanged} คน — ล้มเหลว {r.failed?.length || 0} แถว
          </StatusMessage>
        ),
      }}
    </SectionShell>
  );
}

function StoreMasterSection() {
  const flow = useImportFlow("/store/master/import/preview", "/store/master/import");
  return (
    <SectionShell
      icon={Building2}
      title="Store Master Import"
      flow={flow}
    >
      {{
        onFile: (f) => flow.runPreview(f, {}),
        onConfirm: () => flow.confirmImport({}),
        renderPreview: (p) => (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <StatTile label="ทั้งหมด" value={p.totalRows} />
              <StatTile label="ถูกต้อง" value={p.validRows} />
              <StatTile label="ไม่ถูกต้อง" value={p.invalidRows} />
              <StatTile label="ซ้ำ" value={p.duplicateRows} />
              <StatTile label="สาขาใหม่" value={p.newStoreCount} />
              <StatTile label="Area Coach ใหม่" value={p.newAreaCoachCount} />
            </div>
            <RowsTable
              rows={p.rows}
              columns={[
                { key: "storeId", label: "Store ID" },
                { key: "branch", label: "Branch" },
                { key: "areaCoachName", label: "Area Coach" },
              ]}
            />
          </>
        ),
        renderResult: (r) => (
          <StatusMessage>
            สร้างใหม่ {r.created} สาขา, อัปเดต {r.updated} สาขา, ไม่เปลี่ยนแปลง {r.unchanged} สาขา — สร้าง Area Coach ใหม่ {r.areaCoachesCreated?.length || 0} คน
          </StatusMessage>
        ),
      }}
    </SectionShell>
  );
}

function WhrTargetSection() {
  const flow = useImportFlow("/whr-target/import/preview", "/whr-target/import");
  return (
    <SectionShell
      icon={Target}
      title="WHR Target Import"
      flow={flow}
    >
      {{
        onFile: (f) => flow.runPreview(f, {}),
        onConfirm: () => flow.confirmImport({}),
        renderPreview: (p) => (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <StatTile label="เดือน" value={p.reportMonth ? p.reportMonth.slice(0, 7) : "-"} />
              <StatTile label="ทั้งหมด" value={p.totalRows} />
              <StatTile label="สาขา" value={p.storeCount} />
              <StatTile label="ใหม่" value={p.newRows} />
              <StatTile label="อัปเดต" value={p.updateRows} />
              <StatTile label="ไม่ถูกต้อง" value={p.invalidRows} />
              <StatTile label="ซ้ำในไฟล์" value={p.duplicateInFileRows} />
              <StatTile label="COG เกิน 33%" value={p.cogOverLimitRows} />
            </div>
            <RowsTable
              rows={p.rows}
              columns={[
                { key: "storeId", label: "Store ID" },
                { key: "storeName", label: "Store Name" },
                { key: "monthlySales", label: "Sales" },
                { key: "whrs", label: "WHRS" },
                { key: "productivity", label: "Productivity" },
                { key: "cog", label: "COG" },
                { key: "cogPercent", label: "COG %", render: (r) => (r.cogPercent != null ? `${(r.cogPercent * 100).toFixed(1)}%` : "-") },
              ]}
            />
          </>
        ),
        renderResult: (r) => (
          <StatusMessage>
            เดือน {r.reportMonth?.slice(0, 7)} — นำเข้า {r.imported} / {r.total} แถวสำเร็จ ({r.inserted} ใหม่, {r.updated} อัปเดต) — ล้มเหลว {r.failed?.length || 0} แถว
          </StatusMessage>
        ),
      }}
    </SectionShell>
  );
}

const StatusMessage = ({ children }) => (
  <div style={{ color: "#16a34a", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
    <CheckCircle2 size={15} /> {children}
  </div>
);

export default function UploadExcelTab() {
  return (
    <div>
      <SalesReportSection />
      <SalesByHourSection />
      <EmployeeMasterSection />
      <StoreMasterSection />
      <WhrTargetSection />
    </div>
  );
}
