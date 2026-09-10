import { useEffect, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import './HourlyTrafficChart.css';

/**
 * Floating min-max range bars plus an average line.
 * Recharts draws a floating bar when the value is a [min, max] tuple.
 */
const toSeries = (rows) =>
  rows.map((row) => ({ hour: row.hour, range: [row.min, row.max], avg: row.avg }));

const readChartHeight = () => {
  if (typeof window === 'undefined') return 230;
  const value = getComputedStyle(document.documentElement).getPropertyValue('--chart-h');
  return parseInt(value, 10) || 230;
};

// `data` is the store's real hour-of-day forecast (see services/dashboardService.js).
// With nothing supplied the chart renders empty rather than sample numbers.
export default function HourlyTrafficChart({ data: hourly = [] }) {
  const data = toSeries(hourly);
  const [height, setHeight] = useState(readChartHeight);

  useEffect(() => {
    const onResize = () => setHeight(readChartHeight());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="traffic-chart">
      <h2 className="traffic-chart__title">Hourly Traffic Analysis (Sales Distribution)</h2>
      <p className="traffic-chart__subtitle">
        กราฟแสดงการกระจายตัวของยอดขายรายชั่วโมง (Min-Max Range &amp; Average)
        <br />
        เพื่อใช้ประกอบการตัดสินใจช่วงเวลาปิดร้านและจัดกะ
      </p>

      <div className="traffic-chart__canvas">
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 18, left: 4 }}>
            <CartesianGrid stroke="#eceaf0" vertical={false} />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 8, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={{ stroke: '#e5e7eb' }}
              label={{ value: 'Time of Day', position: 'insideBottom', offset: -12, fontSize: 8, fill: '#9ca3af' }}
            />
            <YAxis
              tick={{ fontSize: 8, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={{ stroke: '#e5e7eb' }}
              width={38}
              label={{ value: 'Sales (THB)', angle: -90, position: 'insideLeft', fontSize: 8, fill: '#9ca3af' }}
            />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }}
              formatter={(value, name) =>
                Array.isArray(value)
                  ? [`${value[0].toLocaleString()} - ${value[1].toLocaleString()}`, name]
                  : [value.toLocaleString(), name]
              }
            />
            <Legend
              verticalAlign="top"
              height={26}
              iconType="square"
              wrapperStyle={{ fontSize: 9 }}
            />
            <Bar
              dataKey="range"
              name="Min-Max Sales Range"
              fill="#e9c9f7"
              stroke="#c084fc"
              barSize={16}
              radius={2}
            />
            <Line
              type="monotone"
              dataKey="avg"
              name="Average Sales (฿)"
              stroke="#f0b429"
              strokeWidth={1.5}
              dot={{ r: 2.5, fill: '#f0b429', strokeWidth: 0 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
