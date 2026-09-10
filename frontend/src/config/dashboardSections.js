/**
 * Dashboard sections whose charts were never built.
 *
 * These are titles and placeholder captions — the screens render a
 * ChartPlaceholder for each, which is an honest "not built yet" box rather than
 * a chart drawn from invented numbers. Moved out of src/mock/ so nothing here
 * looks like sample data.
 */
export const DASHBOARD_SECTIONS = [
  { id: 'productivity', title: 'Productivity Dashboard', placeholder: 'ยังไม่ได้ทำกราฟนี้' },
  { id: 'kpi', title: 'KPI เปรียบเทียบรายสาขา', placeholder: 'ยังไม่ได้ทำตารางนี้' },
  { id: 'target', title: 'เป้าหมาย: ยอดขาย vs ยอดจริง', placeholder: 'ยังไม่ได้ทำกราฟนี้' },
  { id: 'col', title: 'สัดส่วนต้นทุนแรงงาน (COL) แยกตามสาขา', placeholder: 'ยังไม่ได้ทำกราฟนี้' },
  { id: 'talent', title: '9-Box Talent Grid', placeholder: 'ยังไม่ได้ทำตารางนี้', noIcon: true }
];
