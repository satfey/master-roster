import { BarChart2 } from 'lucide-react';
import Card from '../../components/common/Card';
import ChartPlaceholder from '../../components/common/ChartPlaceholder';
import MetricCard from '../../components/dashboard/MetricCard';
import { useOverviewMetrics } from '../../hooks/useOverviewMetrics';

/**
 * เป้าหมายยอดขาย — no screenshot supplied for this tab yet, so it reuses the
 * existing Overview tile and section-card patterns until the design lands.
 */
export default function TargetsPage() {
  const OVERVIEW_METRICS = useOverviewMetrics();
  return (
    <div className="page">
      <Card title="เป้าหมายยอดขาย - เดือนกรกฎาคม 2569" icon={BarChart2}>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          {OVERVIEW_METRICS.slice(0, 2).map((metric) => (
            <MetricCard key={metric.id} {...metric} />
          ))}
        </div>
      </Card>

      <Card title="เป้าหมาย: ยอดขาย vs ยอดจริง" icon={BarChart2}>
        <ChartPlaceholder label="กราฟเป้าหมาย" height={130} />
      </Card>

      <Card title="ความคืบหน้าเทียบเป้าหมายรายสัปดาห์" icon={BarChart2}>
        <ChartPlaceholder label="กราฟรายสัปดาห์" height={130} />
      </Card>
    </div>
  );
}
