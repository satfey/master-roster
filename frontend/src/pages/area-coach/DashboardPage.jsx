import { BarChart2 } from 'lucide-react';
import Card from '../../components/common/Card';
import ChartPlaceholder from '../../components/common/ChartPlaceholder';
import MetricCard from '../../components/dashboard/MetricCard';
import { useOverviewMetrics } from '../../hooks/useOverviewMetrics';

export default function AreaDashboardPage() {
  const OVERVIEW_METRICS = useOverviewMetrics();
  return (
    <div className="page">
      <Card title="Overview - ทั้งเขต" icon={BarChart2}>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          {OVERVIEW_METRICS.map((metric) => (
            <MetricCard key={metric.id} {...metric} />
          ))}
        </div>
      </Card>

      <Card title="KPI เปรียบเทียบรายสาขาในเขต" icon={BarChart2}>
        <ChartPlaceholder label="ตารางเปรียบเทียบรายสาขา" height={120} />
      </Card>

      <Card title="สัดส่วนต้นทุนแรงงาน (COL) แยกตามสาขา" icon={BarChart2}>
        <ChartPlaceholder label="กราฟ COL" height={120} />
      </Card>
    </div>
  );
}
