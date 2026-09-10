import { BarChart2 } from 'lucide-react';
import Card from '../../components/common/Card';
import ChartPlaceholder from '../../components/common/ChartPlaceholder';
import MetricCard from '../../components/dashboard/MetricCard';
import { useOverviewMetrics } from '../../hooks/useOverviewMetrics';

export default function AdminDashboardPage() {
  const OVERVIEW_METRICS = useOverviewMetrics();
  return (
    <div className="page">
      <Card title="Overview - ทั้งบริษัท" icon={BarChart2}>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          {OVERVIEW_METRICS.map((metric) => (
            <MetricCard key={metric.id} {...metric} />
          ))}
        </div>
      </Card>

      <Card title="KPI เปรียบเทียบรายเขต" icon={BarChart2}>
        <ChartPlaceholder label="ตารางเปรียบเทียบรายเขต" height={120} />
      </Card>

      <Card title="9-Box Talent Grid">
        <ChartPlaceholder label="ตาราง 9-Box" height={120} />
      </Card>
    </div>
  );
}
