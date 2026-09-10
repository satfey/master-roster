import { useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, ChevronLeft, FileText, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import Card from '../../components/common/Card';
import './SalesManagementPage.css';

/** Either the English or the Thai header is accepted for each column. */
const DATE_COLUMNS = ['date', 'วันที่'];
const SALES_COLUMNS = ['sales', 'ยอดขาย'];
const TARGET_COLUMNS = ['target', 'sales_target', 'เป้าหมาย', 'เป้าหมายยอดขาย'];

const readSheet = async (file) => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
};

const findColumn = (headers, candidates) =>
  headers.find((header) => candidates.includes(String(header).trim().toLowerCase()));

const digitsOnly = (value) => String(value).replace(/[^\d]/g, '');
const formatBaht = (value) => (value === '' ? '' : Number(value).toLocaleString());

/**
 * Sales Management (Admin) — bulk sales upload and this month's sales target.
 * Reached from ตั้งค่าระบบ; the route itself is gated by MANAGE_SALES_TARGET.
 */
export default function SalesManagementPage() {
  const navigate = useNavigate();

  const [salesFile, setSalesFile] = useState(null);
  const [salesError, setSalesError] = useState(null);
  const [preview, setPreview] = useState([]);

  // No backend field stores a monthly sales target yet, so this starts empty
  // instead of showing a sample figure that looks like real configuration.
  const [target, setTarget] = useState('');
  const [targetNote, setTargetNote] = useState(null);

  const handleSalesFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSalesError(null);
    setSalesFile(null);
    setPreview([]);

    try {
      const rows = await readSheet(file);
      const headers = rows.length ? Object.keys(rows[0]) : [];
      const dateColumn = findColumn(headers, DATE_COLUMNS);
      const salesColumn = findColumn(headers, SALES_COLUMNS);

      if (!rows.length) {
        setSalesError('ไฟล์นี้ไม่มีข้อมูล');
      } else if (!dateColumn || !salesColumn) {
        setSalesError('ไม่พบคอลัมน์ที่จำเป็น ต้องมีคอลัมน์ date/วันที่ และ sales/ยอดขาย');
      } else {
        setSalesFile({ name: file.name, rows: rows.length });
        setPreview(
          rows.slice(0, 5).map((row, index) => ({
            id: index,
            date: String(row[dateColumn]),
            sales: String(row[salesColumn])
          }))
        );
      }
    } catch {
      setSalesError('อ่านไฟล์ไม่สำเร็จ กรุณาตรวจสอบรูปแบบไฟล์ Excel');
    }

    event.target.value = '';
  };

  const handleTargetFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setTargetNote(null);

    try {
      const rows = await readSheet(file);
      const headers = rows.length ? Object.keys(rows[0]) : [];
      const targetColumn = findColumn(headers, TARGET_COLUMNS);
      const value = targetColumn ? digitsOnly(rows[0][targetColumn]) : '';

      if (!value) {
        setTargetNote({ tone: 'error', text: 'ไม่พบคอลัมน์ target/เป้าหมาย ที่มีตัวเลขในไฟล์นี้' });
      } else {
        setTarget(value);
        setTargetNote({ tone: 'ok', text: `นำเข้าเป้าหมายจาก ${file.name} แล้ว` });
      }
    } catch {
      setTargetNote({ tone: 'error', text: 'อ่านไฟล์ไม่สำเร็จ กรุณาตรวจสอบรูปแบบไฟล์ Excel' });
    }

    event.target.value = '';
  };

  return (
    <div className="page sales-mgmt">
      <div className="page-title-bar">
        <button
          type="button"
          className="back-button"
          onClick={() => navigate('/settings')}
          aria-label="ย้อนกลับไปหน้าตั้งค่าระบบ"
        >
          <ChevronLeft size={20} />
        </button>
        <h1>Sales Management</h1>
        <span className="spacer" />
      </div>

      <Card>
        <div className="sales-mgmt__head">
          <div>
            <h2 className="sales-mgmt__title">
              <FileText size={15} aria-hidden="true" />
              Excel Import
            </h2>
            <p className="sales-mgmt__caption">
              ไฟล์ต้องมีคอลัมน์ชื่อ date/วันที่ และ sales/ยอดขาย
            </p>
          </div>
          <label className="sales-mgmt__upload">
            <Upload size={13} aria-hidden="true" />
            Upload File .xlsx/.csv
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleSalesFile} />
          </label>
        </div>

        {salesError && (
          <p className="sales-mgmt__note is-error">
            <AlertTriangle size={12} aria-hidden="true" />
            {salesError}
          </p>
        )}

        {!salesError && salesFile && (
          <p className="sales-mgmt__note is-ok">
            <CheckCircle2 size={12} aria-hidden="true" />
            {salesFile.name} — อ่านข้อมูลได้ {salesFile.rows} แถว
          </p>
        )}

        {!salesError && !salesFile && (
          <p className="sales-mgmt__note is-warning">
            <AlertTriangle size={12} aria-hidden="true" />
            ยังไม่ได้อัปโหลดไฟล์
          </p>
        )}

        {preview.length > 0 && (
          <div className="scroll-x">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th>ยอดขาย</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={row.id}>
                    <td>{row.date}</td>
                    <td>{row.sales}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="sales-mgmt__head">
          <div>
            <h2 className="sales-mgmt__title">
              <BarChart3 size={15} aria-hidden="true" />
              เป้าหมายยอดขายเดือนนี้ (Sales Target)
            </h2>
          </div>
          <label className="sales-mgmt__upload">
            <Upload size={13} aria-hidden="true" />
            Upload File .xlsx/.csv
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleTargetFile} />
          </label>
        </div>

        <input
          className="sales-mgmt__input"
          value={formatBaht(target)}
          onChange={(e) => {
            setTarget(digitsOnly(e.target.value));
            setTargetNote(null);
          }}
          inputMode="numeric"
          aria-label="เป้าหมายยอดขายเดือนนี้"
        />
        <p className="sales-mgmt__caption">
          บาท / เดือน (สามารถ import ให้โดย Area Coach เท่านั้น)
        </p>

        {targetNote && (
          <p className={`sales-mgmt__note is-${targetNote.tone}`}>
            {targetNote.tone === 'ok' ? (
              <CheckCircle2 size={12} aria-hidden="true" />
            ) : (
              <AlertTriangle size={12} aria-hidden="true" />
            )}
            {targetNote.text}
          </p>
        )}
      </Card>
    </div>
  );
}
