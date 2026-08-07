import React, { useState } from "react";
import { Store, Settings, PlusCircle, Trash2 } from "lucide-react";
import { Card, Btn, th, td, inp } from "../components/ui.jsx";
import { fmtNum } from "../lib/calc.js";

export default function SettingsTab({ branches, guideline, onBranchesChange, onGuidelineChange }) {
  const [newBranch, setNewBranch] = useState("");
  const [tierForm, setTierForm] = useState({ min: "", max: "", hours: "" });

  const addBranch = () => {
    if (!newBranch.trim()) return;
    onBranchesChange([...branches, { id: "b" + Date.now(), name: newBranch.trim() }]);
    setNewBranch("");
  };
  const removeBranch = (id) => onBranchesChange(branches.filter((b) => b.id !== id));

  const addTier = () => {
    if (tierForm.min === "" || tierForm.hours === "") return;
    onGuidelineChange([
      ...guideline,
      { id: Date.now(), min: Number(tierForm.min), max: tierForm.max === "" ? null : Number(tierForm.max), hours: Number(tierForm.hours) },
    ]);
    setTierForm({ min: "", max: "", hours: "" });
  };
  const removeTier = (id) => onGuidelineChange(guideline.filter((t) => t.id !== id));

  return (
    <div>
      <Card title="จัดการสาขา" icon={Store}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input placeholder="ชื่อสาขาใหม่" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} style={inp} />
          <Btn icon={PlusCircle} onClick={addBranch}>เพิ่มสาขา</Btn>
        </div>
        {branches.map((b) => (
          <div key={b.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
            {b.name}
            <Btn small variant="danger" icon={Trash2} onClick={() => removeBranch(b.id)}>ลบ</Btn>
          </div>
        ))}
      </Card>

      <Card title="ไกด์ไลน์ชั่วโมงแรงงานตามยอดขาย (Labor Guideline)" icon={Settings}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <input type="number" placeholder="ยอดขายขั้นต่ำ" value={tierForm.min} onChange={(e) => setTierForm({ ...tierForm, min: e.target.value })} style={{ ...inp, width: 140 }} />
          <input type="number" placeholder="ยอดขายสูงสุด (ว่าง=ไม่จำกัด)" value={tierForm.max} onChange={(e) => setTierForm({ ...tierForm, max: e.target.value })} style={{ ...inp, width: 180 }} />
          <input type="number" placeholder="ชั่วโมงที่อนุญาต" value={tierForm.hours} onChange={(e) => setTierForm({ ...tierForm, hours: e.target.value })} style={{ ...inp, width: 140 }} />
          <Btn icon={PlusCircle} onClick={addTier}>เพิ่มช่วง</Btn>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th}>ยอดขาย (บาท)</th>
              <th style={th}>ชั่วโมงที่อนุญาต</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {[...guideline].sort((a, b) => a.min - b.min).map((t) => (
              <tr key={t.id}>
                <td style={td}>฿{fmtNum(t.min)} - {t.max === null ? "ไม่จำกัด" : `฿${fmtNum(t.max)}`}</td>
                <td style={td}>{fmtNum(t.hours)} ชม.</td>
                <td style={td}>
                  <Btn small variant="danger" icon={Trash2} onClick={() => removeTier(t.id)}>ลบ</Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
