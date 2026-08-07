# Master Roster (React Prototype)

ระบบจัดกะพนักงานอัตโนมัติตามยอดขาย + KPI Dashboard แยกตาม Role
(Store Manager / Area Coach / ผู้บริหาร)

## เริ่มใช้งาน

```bash
npm install
npm run dev
```

จากนั้นเปิด http://localhost:5173

## โครงสร้างโปรเจกต์

```
src/
  App.jsx              # เชื่อม state หลัก, top bar, tab navigation
  components/ui.jsx    # UI พื้นฐานที่ใช้ร่วมกัน (Card, Btn, Badge, KpiTile, Select)
  lib/calc.js           # date helper, forecast, guideline lookup, generate schedule algorithm
  lib/storage.js        # เก็บข้อมูลด้วย localStorage (เปลี่ยนเป็นเรียก API จริงได้ทีหลัง)
  pages/
    SalesTab.jsx         # นำเข้ายอดขาย + พยากรณ์ + บันทึกยอดขายรายวัน
    RosterTab.jsx         # จัดการพนักงาน + สร้างตารางกะอัตโนมัติ
    ApproveTab.jsx         # อนุมัติ/ตีกลับตารางกะ (มุมมอง Area Coach vs Store Manager)
    HoursTab.jsx            # บันทึก/นำเข้าชั่วโมงทำงานจริง
    DashboardTab.jsx         # KPI Dashboard แยกตาม role
    SettingsTab.jsx           # จัดการสาขา + ไกด์ไลน์ชั่วโมงแรงงาน
```

## หมายเหตุสำคัญก่อนใช้งานจริง

- ตอนนี้ข้อมูลเก็บใน `localStorage` ของเบราว์เซอร์เท่านั้น (ข้อมูลไม่ sync ข้ามเครื่อง/คน) —
  สำหรับใช้งานจริงต้องต่อ backend API + database จริง แล้วแก้ไฟล์ `src/lib/storage.js`
  ให้เรียก API แทน
- ยังไม่มีระบบ login/authentication จริง — role/สาขาเลือกจาก dropdown เพื่อ demo เท่านั้น
- อัลกอริทึม generate ตารางกะ (`generateSchedule` ใน `lib/calc.js`) เป็นแบบง่าย
  (กระจายชั่วโมงตามน้ำหนักยอดขายรายวัน + round robin ตามพนักงานที่มีชั่วโมงสะสมน้อยสุด)
  ควรคุยกับทีมเพิ่มเติมเรื่อง business rule เช่น กะเช้า/บ่าย/เย็น, วันหยุดพนักงาน, กฎ OT ตามกฎหมายแรงงานไทย
