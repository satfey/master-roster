import { BarChart2 } from 'lucide-react';
import Card from '../../components/common/Card';
import ChartPlaceholder from '../../components/common/ChartPlaceholder';
import MetricCard from '../../components/dashboard/MetricCard';
import HourlyTrafficChart from '../../components/dashboard/HourlyTrafficChart';
import { DASHBOARD_SECTIONS } from '../../config/dashboardSections';
import { useOverviewMetrics } from '../../hooks/useOverviewMetrics';
import './DashboardPage.css';

export default function DashboardPage() {
  const OVERVIEW_METRICS = useOverviewMetrics();
  return (
    <div className="page dashboard-page">
      <Card title="Overview" icon={BarChart2}>
        <div className="dashboard-page__metrics">
          {OVERVIEW_METRICS.map((metric) => (
            <MetricCard key={metric.id} {...metric} />
          ))}
        </div>
      </Card>

      {DASHBOARD_SECTIONS.map((section) => (
        <Card
          key={section.id}
          title={section.title}
          icon={section.noIcon ? undefined : BarChart2}
        >
          <ChartPlaceholder label={section.placeholder} height={120} />
        </Card>
      ))}

      <HourlyTrafficChart />
    </div>
  );
}
