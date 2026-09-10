import { useEffect, useState } from 'react';
import { ArrowRight, Store } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import FullPageLoader from '../../components/common/FullPageLoader';
import EmptyState from '../../components/common/EmptyState';
import { useAuth } from '../../hooks/useAuth';
import { useStoreScope } from '../../hooks/useStoreScope';
import { getStoresForUser } from '../../services/storeService';

/** Only stores inside the coach's own area are ever returned. */
export default function AreaStoresPage() {
  const { user } = useAuth();
  const { selectStore } = useStoreScope();
  const navigate = useNavigate();
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    getStoresForUser(user)
      .then((list) => active && setStores(list))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [user]);

  const openStore = (store) => {
    if (!selectStore(store.id)) {
      setError('ไม่มีสิทธิ์เข้าถึงข้อมูลสาขานี้');
      return;
    }
    navigate('/roster');
  };

  if (loading) return <FullPageLoader />;

  return (
    <div className="page">
      {error && <p className="roster-page__error">{error}</p>}

      <Card title={`สาขาในเขต ${user?.areaName ?? ''}`} icon={Store}>
        {stores.length === 0 ? (
          <EmptyState icon={Store} title="ยังไม่มีสาขาในเขตนี้" />
        ) : (
          <div className="scroll-x">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>รหัสสาขา</th>
                  <th>ชื่อสาขา</th>
                  <th>เขต</th>
                  <th aria-label="ดูตาราง" />
                </tr>
              </thead>
              <tbody>
                {stores.map((store) => (
                  <tr key={store.id}>
                    <td>{store.code ?? store.id}</td>
                    <td>{store.nameTh ?? store.name}</td>
                    <td>{store.areaName}</td>
                    <td>
                      <Button
                        variant="primary"
                        size="sm"
                        icon={ArrowRight}
                        iconPosition="right"
                        onClick={() => openStore(store)}
                      >
                        ดูตาราง
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
