import { ScrollText } from 'lucide-react';
import Card from '../../components/common/Card';
import './AuditLogPage.css';

const AUDIT_ROWS = [
  { id: 'l1', timestamp: '2026-07-04 09:12', user: 'Store Manager Demo', employeeId: 'DQ-202601', role: 'Store Manager', action: 'GENERATE_SCHEDULE', module: 'Roster', store: 'Store A', details: 'สร้างตารางเดือน July 2026' },
  { id: 'l2', timestamp: '2026-07-04 10:41', user: 'Area Coach Demo', employeeId: 'AC001', role: 'Area Coach', action: 'VIEW_SCHEDULE', module: 'Roster', store: 'Store B', details: 'เปิดดูตารางสาขา' },
  { id: 'l3', timestamp: '2026-07-05 08:03', user: 'HR Administrator', employeeId: 'HR001', role: 'Admin', action: 'IMPORT_FILE', module: 'Import', store: '-', details: 'นำเข้า sales_july.xlsx' }
];

/** Admin only — the route guard blocks a manually typed URL as well. */
export default function AuditLogPage() {
  return (
    <div className="page">
      <Card title="System Audit Log" icon={ScrollText}>
        <p className="audit-caption">
          บันทึกการเปลี่ยนแปลงที่สำคัญในระบบ (Administrator Tracking Only)
        </p>
        <div className="scroll-x">
          <table className="staff-table audit-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Employee ID</th>
                <th>Role</th>
                <th>Action</th>
                <th>Module</th>
                <th>Store</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {AUDIT_ROWS.map((row) => (
                <tr key={row.id}>
                  <td>{row.timestamp}</td>
                  <td>{row.user}</td>
                  <td>{row.employeeId}</td>
                  <td>{row.role}</td>
                  <td>{row.action}</td>
                  <td>{row.module}</td>
                  <td>{row.store}</td>
                  <td>{row.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
