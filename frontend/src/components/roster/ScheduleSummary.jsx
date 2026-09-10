import './ScheduleSummary.css';

/** Navy Schedule Generation panel with the Quota / Scheduled pair. */
export default function ScheduleSummary({ quota, scheduled }) {
  return (
    <section className="schedule-summary">
      <header className="schedule-summary__head">
        <h2>Schedule Generation</h2>
        <p>ระบบจะจัดตารางให้อัตโนมัติ โดยอิงจากโควตาและความต้องการกำลังคน</p>
      </header>

      <div className="schedule-summary__figures">
        <div className="schedule-figure">
          <p className="schedule-figure__label">Quota</p>
          <p className="schedule-figure__value">{quota}</p>
          <p className="schedule-figure__unit">ชม./เดือน</p>
        </div>
        <div className="schedule-figure">
          <p className="schedule-figure__label">Scheduled</p>
          <p className="schedule-figure__value schedule-figure__value--green">{scheduled}</p>
          <p className="schedule-figure__unit">ชม. ที่จัดแล้ว</p>
        </div>
      </div>
    </section>
  );
}
