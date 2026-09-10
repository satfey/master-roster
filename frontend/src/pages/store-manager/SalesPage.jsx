import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useStoreScope } from '../../hooks/useStoreScope';
import { getSalesOverview } from '../../services/salesService';
import { BarChart2 } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import Card from '../../components/common/Card';
import ChartPlaceholder from '../../components/common/ChartPlaceholder';
import './SalesPage.css';

export default function SalesPage() {
  // Real reported sales for the store in scope (GET /sales) plus the forecast's
  // hour-of-day split. Empty until they load; nothing is filled in meanwhile.
  const { user } = useAuth();
  const { selectedStoreId } = useStoreScope();
  const [overview, setOverview] = useState({ stats: [], hours: [], trend: [] });

  useEffect(() => {
    let active = true;
    const storeId = selectedStoreId ?? user?.storeId;
    if (!storeId) return undefined;
    getSalesOverview(user, storeId)
      .then((data) => active && setOverview(data))
      .catch(() => active && setOverview({ stats: [], hours: [], trend: [] }));
    return () => {
      active = false;
    };
  }, [user, selectedStoreId]);

  return (
    <div className="page sales-page">
      <Card title="ยอดขายรายวัน - เดือนกรกฎาคม 2569" icon={BarChart2}>
        <div className="sales-page__chart">
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={overview.trend} margin={{ top: 6, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#f0f0f2" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={42} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Legend verticalAlign="bottom" height={22} iconType="circle" wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="actual" name="ยอดขายจริง" stroke="#16a34a" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="target" name="เป้าหมาย" stroke="#f0b429" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="sales-page__stats">
          {overview.stats.map((stat) => (
            <div key={stat.id} className={`sales-stat sales-stat--${stat.tone}`}>
              <p className="sales-stat__label">{stat.label}</p>
              <p className="sales-stat__value">{stat.value}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card title="เป้าหมาย: ยอดขาย vs ยอดจริง" icon={BarChart2}>
        <ChartPlaceholder label="กราฟเป้าหมาย" height={110} />
      </Card>

      <Card title="สรุปชั่วโมงการทำงาน" icon={BarChart2}>
        <div className="sales-page__hours">
          {overview.hours.map((item) => (
            <div key={item.id} className={`hour-tile hour-tile--${item.tone}`}>
              <p className="hour-tile__label">{item.label}</p>
              <p className="hour-tile__value">{item.value}</p>
              {item.caption && <p className="hour-tile__caption">{item.caption}</p>}
            </div>
          ))}
        </div>
      </Card>

      <Card title="บันทึกยอดขายรายวัน (Sales Management)">
        <ChartPlaceholder label="ตารางบันทึกยอดขาย" height={110} />
      </Card>

      <Card title="บันทึกปริมาณกำลังคนรายวัน">
        <ChartPlaceholder label="ตารางบันทึกกำลังคน" height={110} />
      </Card>
    </div>
  );
}
