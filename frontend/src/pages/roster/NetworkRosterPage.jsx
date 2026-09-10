import { useEffect, useMemo, useState } from 'react';
import { BarChart2, Store } from 'lucide-react';
import Card from '../../components/common/Card';
import EmptyState from '../../components/common/EmptyState';
import FullPageLoader from '../../components/common/FullPageLoader';
import ChartPlaceholder from '../../components/common/ChartPlaceholder';
import HourlyTrafficChart from '../../components/dashboard/HourlyTrafficChart';
import ScheduleSummary from '../../components/roster/ScheduleSummary';
import ExceptionHeatmap from '../../components/roster/ExceptionHeatmap';
import StoreExceptionModal from '../../components/roster/StoreExceptionModal';
import { useAuth } from '../../hooks/useAuth';
import { useStoreScope } from '../../hooks/useStoreScope';
import { EXCEPTION_STATUS_LEGEND } from '../../config/rosterDisplay';
import { buildExceptionRows } from '../../utils/exceptionHeatmap';
import { totalScheduledHours } from '../../utils/rosterUtils';
import { getNetworkRoster } from '../../services/rosterService';
import './NetworkRosterPage.css';

/**
 * The roster page as Admin and Area Coach see it before picking a store:
 * every store in scope rolled into one exception heatmap. Clicking a pin opens
 * the list of stores behind it, and from there a single store's roster.
 */
export default function NetworkRosterPage() {
  const { user } = useAuth();
  const { selectStore } = useStoreScope();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selection, setSelection] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getNetworkRoster(user)
      .then((result) => active && setData(result))
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [user]);

  const rows = useMemo(
    () => (data ? buildExceptionRows(data.storeRosters, data.days, data.blocks) : []),
    [data]
  );

  const scheduledHours = useMemo(
    () =>
      data
        ? data.storeRosters.reduce(
            (sum, entry) => sum + totalScheduledHours(entry.staff, data.days),
            0
          )
        : 0,
    [data]
  );

  const handleOpenStore = (store) => {
    // Scope is re-checked here: a store outside the session's area never opens.
    if (!selectStore(store.id)) {
      setError('ไม่มีสิทธิ์เข้าถึงข้อมูลสาขานี้');
      return;
    }
    setSelection(null);
  };

  if (loading) return <FullPageLoader />;

  if (!data || data.storeRosters.length === 0) {
    return (
      <div className="page">
        <Card>
          <EmptyState
            icon={Store}
            title="ยังไม่มีสาขาในขอบเขตของคุณ"
            description={error ?? 'ติดต่อผู้ดูแลระบบเพื่อกำหนดสาขาที่รับผิดชอบ'}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="page network-roster">
      {error && <p className="network-roster__error">{error}</p>}

      <Card title="สัดส่วนต้นทุนแรงงาน (COL) ทุกสาขา" icon={BarChart2}>
        <ChartPlaceholder label={'กราฟ COL\n(เพื่อดูสถานะเปรียบเทียบ Budget vs Actual แยกสาขา)'} height={110} />
      </Card>

      <ScheduleSummary quota={data.quota} scheduled={scheduledHours} />

      <Card>
        <h2 className="network-roster__heading">
          Headcount Demand vs Scheduled (Exception Heatmap)
        </h2>
        <p className="network-roster__hint">
          รวมทุกสาขาในขอบเขตของคุณ ({data.storeCount} สาขา) หมุดคือจำนวนสาขาที่มีปัญหาในช่วงเวลานั้น
          <br />
          กดที่หมุดเพื่อดูรายชื่อสาขา แล้วเข้าไปดูตารางของสาขานั้นได้ทันที
        </p>
        <ExceptionHeatmap
          days={data.days}
          rows={rows}
          legend={EXCEPTION_STATUS_LEGEND}
          onSelect={(row, cell, status) => setSelection({ row, cell, status })}
        />
      </Card>

      <HourlyTrafficChart />

      <StoreExceptionModal
        selection={selection}
        onClose={() => setSelection(null)}
        onOpenStore={handleOpenStore}
      />
    </div>
  );
}
