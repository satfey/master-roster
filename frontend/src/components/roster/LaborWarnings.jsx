import { AlertTriangle, ShieldCheck, Store } from 'lucide-react';
import './LaborWarnings.css';

/** Compliance panel for contract limits, labour law and store floor rules. */
export default function LaborWarnings({ staffResults = [], storeIssues = [] }) {
  const total =
    staffResults.reduce((sum, entry) => sum + entry.violations.length, 0) + storeIssues.length;

  if (total === 0) {
    return (
      <div className="labor-warnings labor-warnings--clean">
        <ShieldCheck size={15} aria-hidden="true" />
        ตารางนี้ผ่านเงื่อนไขสัญญาจ้าง กฎหมายแรงงาน และกฎหน้าร้านทุกข้อ
      </div>
    );
  }

  return (
    <div className="labor-warnings">
      <p className="labor-warnings__head">
        <AlertTriangle size={15} aria-hidden="true" />
        พบ {total} รายการที่ต้องแก้ไข
      </p>

      <ul>
        {storeIssues.length > 0 && (
          <li>
            <span className="labor-warnings__name">
              <Store size={11} aria-hidden="true" /> กฎหน้าร้าน
            </span>
            <ul>
              {storeIssues.map((issue, index) => (
                <li key={`${issue.code}-${issue.day ?? index}`} className={`is-${issue.severity}`}>
                  {issue.message}
                </li>
              ))}
            </ul>
          </li>
        )}

        {staffResults.map((entry) => (
          <li key={entry.staffId}>
            <span className="labor-warnings__name">{entry.name}</span>
            <ul>
              {entry.violations.map((violation, index) => (
                <li
                  key={`${violation.code}-${violation.day ?? index}`}
                  className={`is-${violation.severity}`}
                >
                  {violation.message}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
