import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HOME_PATH } from '../config/roles';
import './UnauthorizedPage.css';

export default function NotFoundPage() {
  const { role, isAuthenticated } = useAuth();
  const home = isAuthenticated ? ROLE_HOME_PATH[role] ?? '/dashboard' : '/login';

  return (
    <div className="unauthorized">
      <h1>ไม่พบหน้าที่ต้องการ</h1>
      <p>ลิงก์อาจถูกย้ายหรือพิมพ์ผิด</p>
      <Link to={home} className="unauthorized__link">
        กลับไปหน้าหลัก
      </Link>
    </div>
  );
}
