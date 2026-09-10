import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ClipboardList, Store } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import FullPageLoader from '../../components/common/FullPageLoader';
import ExceptionHeatmap from '../../components/roster/ExceptionHeatmap';
import StoreExceptionModal from '../../components/roster/StoreExceptionModal';
import { useAuth } from '../../hooks/useAuth';
import { useStoreScope } from '../../hooks/useStoreScope';
import { DAY_LABELS, EXCEPTION_STATUS_LEGEND } from '../../config/rosterDisplay';
import { buildExceptionRows, summariseByStore } from '../../utils/exceptionHeatmap';
import { getNetworkRoster } from '../../services/rosterService';

/**
 * Abnormal schedule review for the Area Coach — only stores inside their own
 * area are ever loaded, because getNetworkRoster scopes by the session.
 * Every row leads to that store's roster through the same pop-up flow as the
 * Admin heatmap.
 */
export default function ScheduleReviewPage() {
  const { user } = useAuth();
  const { selectStore } = useStoreScope();
  const navigate = useNavigate();

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

  const anomalies = useMemo(() => {
    if (!data) return [];
    const byStore = summariseByStore(rows);

    return data.storeRosters
      .map(({ store, staff, dailySales }) => {
        const exception = byStore.find((entry) => entry.store.id === store.id);
        // Compliance is graded by the backend (POST /roster/validate). This screen has no
        // roster of its own to grade yet, so it reports none rather than re-deriving rules here.
        const staffViolations = 0;
        // Store-level rules are graded by the backend (POST /roster/validate), not
        // re-derived here. This page still runs on mock data and has no roster to
        // validate against, so it reports staff-level findings only.
        const storeIssues = [];
        const details = [];

        if (exception?.worst) {
          const { day, block, status, gap } = exception.worst;
          details.push(
            `${DAY_LABELS[day] ?? day} ${block}: ${status === 'understaffed' ? 'ขาด' : 'เกิน'} ${gap} คน`
          );
        }
        if (staffViolations > 0) details.push(`ผิดเงื่อนไขการจ้าง/กฎหมายแรงงาน ${staffViolations} รายการ`);
        if (storeIssues.length > 0) details.push(`กฎหน้าร้าน ${storeIssues.length} รายการ`);

        return {
          store,
          understaffed: exception?.understaffed ?? 0,
          overstaffed: exception?.overstaffed ?? 0,
          staffViolations,
          storeIssues: storeIssues.length,
          detail: details.join(' · ')
        };
      })
      .filter((row) => row.detail)
      .sort((a, b) => b.understaffed - a.understaffed || b.staffViolations - a.staffViolations);
  }, [data, rows]);

  const openStore = (store) => {
    // Re-checked against the session scope before leaving this page.
    if (!selectStore(store.id)) {
      setError('ไม่มีสิทธิ์เข้าถึงข้อมูลสาขานี้');
      return;
    }
    setSelection(null);
    navigate('/roster');
  };

  if (loading) return <FullPageLoader />;

  if (!data || data.storeRosters.length === 0) {
    return (
      <div className="page">
        <Card>
          <EmptyState
            icon={Store}
            title="ยังไม่มีสาขาในเขตของคุณ"
            description={error ?? 'ติดต่อผู้ดูแลระบบเพื่อกำหนดสาขาที่รับผิดชอบ'}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      {error && <p className="roster-page__error">{error}</p>}

      <Card title={`รายการตารางที่ผิดปกติ (${data.storeCount} สาขาในขอบเขต)`} icon={ClipboardList}>
        {anomalies.length === 0 ? (
          <EmptyState icon={ClipboardList} title="ทุกสาขาผ่านเกณฑ์" />
        ) : (
          <div className="scroll-x">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>สาขา</th>
                  <th>ขาดคน</th>
                  <th>เกินคน</th>
                  <th>รายละเอียด</th>
                  <th aria-label="ดูตาราง" />
                </tr>
              </thead>
              <tbody>
                {anomalies.map((row) => (
                  <tr key={row.store.id}>
                    <td>
                      {row.store.nameTh ?? row.store.name}
                      <br />
                      <span style={{ color: 'var(--text-faint)' }}>
                        ID: {row.store.code ?? row.store.id}
                      </span>
                    </td>
                    <td style={{ color: row.understaffed ? 'var(--red)' : 'var(--text-faint)' }}>
                      {row.understaffed} ช่วง
                    </td>
                    <td style={{ color: row.overstaffed ? 'var(--amber)' : 'var(--text-faint)' }}>
                      {row.overstaffed} ช่วง
                    </td>
                    <td style={{ whiteSpace: 'normal' }}>{row.detail}</td>
                    <td>
                      <Button
                        variant="primary"
                        size="sm"
                        icon={ArrowRight}
                        iconPosition="right"
                        onClick={() => openStore(row.store)}
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

      <Card title="Headcount Demand vs Scheduled (Exception Heatmap)">
        <ExceptionHeatmap
          days={data.days}
          rows={rows}
          legend={EXCEPTION_STATUS_LEGEND}
          onSelect={(row, cell, status) => setSelection({ row, cell, status })}
        />
      </Card>

      <StoreExceptionModal
        selection={selection}
        onClose={() => setSelection(null)}
        onOpenStore={openStore}
      />
    </div>
  );
}
