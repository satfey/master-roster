import { useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import './ImportPage.css';

const REQUIRED_COLUMNS = ['store_id', 'date', 'gross_sales'];

/** Admin only. Reads the sheet in the browser, then previews and validates it. */
export default function ImportPage() {
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState(null);

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const parsed = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      setRows(parsed);
      setHeaders(parsed.length ? Object.keys(parsed[0]) : []);
    } catch {
      setError('อ่านไฟล์ไม่สำเร็จ กรุณาตรวจสอบรูปแบบไฟล์ Excel');
      setRows([]);
      setHeaders([]);
    }
  };

  const missingColumns = headers.length
    ? REQUIRED_COLUMNS.filter((col) => !headers.includes(col))
    : [];

  return (
    <div className="page">
      <Card title="นำเข้าข้อมูลจากไฟล์ Excel" icon={FileSpreadsheet}>
        <label className="import-dropzone">
          <Upload size={22} strokeWidth={1.5} aria-hidden="true" />
          <span>{fileName || 'เลือกไฟล์ .xlsx หรือ .csv'}</span>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
        </label>

        {error && <p className="import-error">{error}</p>}

        {missingColumns.length > 0 && (
          <p className="import-error">คอลัมน์ที่จำเป็นหายไป: {missingColumns.join(', ')}</p>
        )}

        {rows.length === 0 ? (
          <EmptyState icon={FileSpreadsheet} title="ยังไม่มีข้อมูลตัวอย่าง" description="เลือกไฟล์เพื่อดูตัวอย่างข้อมูลก่อนนำเข้า" />
        ) : (
          <>
            <div className="scroll-x">
              <table className="staff-table">
                <thead>
                  <tr>
                    {headers.map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 10).map((row, index) => (
                    <tr key={index}>
                      {headers.map((header) => (
                        <td key={header}>{String(row[header])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="import-count">แสดง {Math.min(rows.length, 10)} จาก {rows.length} แถว</p>
            <Button variant="primary" size="sm" disabled={missingColumns.length > 0}>
              นำเข้าข้อมูล
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
