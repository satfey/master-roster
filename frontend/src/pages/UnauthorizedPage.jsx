import { ShieldAlert } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HOME_PATH } from '../config/roles';
import './UnauthorizedPage.css';

export default function UnauthorizedPage() {
  const { role } = useAuth();
  const location = useLocation();
  const fallback = location.state?.fallback ?? ROLE_HOME_PATH[role] ?? '/login';

  return (
    <div className="unauthorized">
      <ShieldAlert size={40} strokeWidth={1.5} aria-hidden="true" />
      <h1>ไม่มีสิทธิ์เข้าถึงหน้านี้</h1>
      <p>บัญชีของคุณไม่ได้รับสิทธิ์สำหรับหน้านี้ หากคิดว่าผิดพลาด กรุณาติดต่อผู้ดูแลระบบ</p>
      <Link to={fallback} className="unauthorized__link">
        กลับไปหน้าหลัก
      </Link>
    </div>
  );
}
