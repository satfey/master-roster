import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import { STORE_COVERAGE } from '../../config/storeRules';
import './StoreManagementPage.css';

const FIELDS = [
  { id: 'defaultOpeningTime', label: 'Default Opening Time', caption: '', type: 'time' },
  { id: 'defaultClosingTime', label: 'Default Closing Time', caption: '', type: 'time' },
  {
    id: 'suggestedEntryCloseTime',
    label: 'Suggested Entry Close Time',
    caption: 'เวลาปิดร้านที่ระบบแนะนำ (ตาม AI)',
    type: 'text'
  },
  {
    id: 'minDailySalesThreshold',
    label: 'Min. Daily Sales Threshold (฿)',
    caption: 'ยอดขายขั้นต่ำต่อวันที่ยังคุ้มค่าการเปิดร้าน',
    type: 'text'
  }
];

export default function StoreManagementPage() {
  const navigate = useNavigate();
  // Operating hours mirror the backend's own constants (storeOperatingHours.js);
  // the previous 10:00-19:00 defaults here were invented and contradicted it.
  const [rules, setRules] = useState({
    defaultOpeningTime: STORE_COVERAGE.openingTime,
    defaultClosingTime: STORE_COVERAGE.closingTime,
    suggestedEntryCloseTime: '',
    minDailySalesThreshold: '',
  });
  const [saved, setSaved] = useState(false);

  const update = (id, value) => {
    setRules((prev) => ({ ...prev, [id]: value }));
    setSaved(false);
  };

  return (
    <div className="page">
      <div className="page-title-bar">
        <button
          type="button"
          className="back-button"
          onClick={() => navigate('/settings')}
          aria-label="ย้อนกลับไปหน้าตั้งค่าระบบ"
        >
          <ChevronLeft size={20} />
        </button>
        <h1>Store Management</h1>
        <span className="spacer" />
      </div>

      <Card>
        <h2 className="store-rules__title">Business Rules Engine</h2>
        <p className="store-rules__caption">
          ตั้งค่ากติกาพื้นฐานของสาขา เพื่อให้ระบบใช้ประกอบการจัดตารางและคำนวณต้นทุน
        </p>

        <div className="store-rules__grid">
          {FIELDS.map((field) => (
            <label key={field.id} className="store-rules__field" htmlFor={field.id}>
              <span className="store-rules__label">{field.label}</span>
              {field.caption && <span className="store-rules__hint">{field.caption}</span>}
              <input
                id={field.id}
                type={field.type}
                value={rules[field.id]}
                onChange={(e) => update(field.id, e.target.value)}
              />
            </label>
          ))}
        </div>

        <div className="store-rules__actions">
          <Button variant="primary" size="sm" onClick={() => setSaved(true)}>
            บันทึกการตั้งค่า
          </Button>
          {saved && <span className="store-rules__saved">บันทึกแล้ว</span>}
        </div>
      </Card>
    </div>
  );
}
