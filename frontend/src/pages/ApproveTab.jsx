import React, { useState } from "react";
import { ClipboardCheck, XCircle, CheckCircle2, RefreshCcw } from "lucide-react";
import { Card, Btn, Badge, inp } from "../components/ui.jsx";
import { fmtNum } from "../lib/calc.js";

export default function ApproveTab({ role, branches, month, scheduleByBranch, selectedBranch, onDecision, onResubmit }) {
  const [comments, setComments] = useState({});

  if (role === "store_manager") {
    const s = scheduleByBranch[selectedBranch];
    return (
      <Card title="สถานะการอนุมัติกะของสาขาฉัน" icon={ClipboardCheck}>
        {!s ? (
          <div style={{ color: "#94a3b8" }}>ยังไม่มีตารางกะที่ส่งขออนุมัติ</div>
        ) : (
          <div>
            <div style={{ marginBottom: 10 }}>
              <Badge status={s.status} />
            </div>
            {s.comment && <div style={{ fontSize: 13, color: "#b91c1c", marginBottom: 10 }}>ความเห็นจาก Area Coach: {s.comment}</div>}
            {s.status === "rejected" && (
              <Btn icon={RefreshCcw} onClick={onResubmit}>แก้ไขแล้วส่งใหม่</Btn>
            )}
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card title={`รายการตารางกะรออนุมัติ — เดือน ${month}`} icon={ClipboardCheck}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {branches.map((b) => {
          const s = scheduleByBranch[b.id];
          const status = s ? s.status : "none";
          return (
            <div key={b.id} style={{ border: "1px solid #eef1f5", borderRadius: 10, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{b.name}</div>
                  <div style={{ marginTop: 4 }}>
                    <Badge status={status} />
                  </div>
                  {s && (
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                      ชั่วโมงไกด์ไลน์ {fmtNum(s.totalGuidelineHours)} ชม. • จัดกะรวม{" "}
                      {fmtNum(Object.values(s.shifts).reduce((a, arr) => a + arr.reduce((x, y) => x + y.hours, 0), 0))} ชม.
                    </div>
                  )}
                </div>
                {status === "submitted" && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      placeholder="ความเห็น (ถ้าตีกลับ)"
                      value={comments[b.id] || ""}
                      onChange={(e) => setComments({ ...comments, [b.id]: e.target.value })}
                      style={{ ...inp, width: 200 }}
                    />
                    <Btn small variant="danger" icon={XCircle} onClick={() => onDecision(b.id, "rejected", comments[b.id] || "กรุณาแก้ไขและส่งใหม่")}>
                      ตีกลับ
                    </Btn>
                    <Btn small icon={CheckCircle2} onClick={() => onDecision(b.id, "approved", "")}>
                      อนุมัติ
                    </Btn>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
