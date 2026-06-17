import { useState } from "react";
import type { InteractivePuzzleProps } from "./types";
import { pBtn, pBtnGhost, Feedback } from "./ui";

export default function FoodChainOrder({ payload, onSolved, disabled }: InteractivePuzzleProps) {
  const items = (payload.params.items as string[]) || [];
  const order = ((payload.solution as { order?: string[] })?.order) || [];
  const [seq, setSeq] = useState<string[]>([]);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const locked = disabled || correct === true;

  const pick = (it: string) => {
    if (locked || seq.includes(it)) return;
    setSeq((s) => [...s, it]);
    setCorrect(null);
  };
  const check = () => {
    const ok = seq.length === order.length && seq.every((v, i) => v === order[i]);
    setCorrect(ok);
    onSolved(seq.join(" → "), ok);
  };

  const chip = (active: boolean): React.CSSProperties => ({
    padding: "10px 16px", borderRadius: 10, fontWeight: 700, fontSize: 14,
    border: `1.5px solid ${active ? "#cbd5e1" : "#16a34a"}`,
    background: active ? "#f1f5f9" : "#dcfce7", color: active ? "#94a3b8" : "#15803d",
    cursor: active ? "default" : "pointer",
  });

  return (
    <div style={{ textAlign: "center" }}>
      <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 8px" }}>Tap the organisms in order (producer first):</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        {items.map((it) => (
          <button key={it} style={chip(seq.includes(it))} onClick={() => pick(it)}>{it}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center", flexWrap: "wrap", minHeight: 44, margin: "12px 0", fontWeight: 700, color: "#1e293b" }}>
        {seq.length === 0 ? <span style={{ color: "#94a3b8", fontWeight: 400 }}>Your chain appears here…</span>
          : seq.map((s, i) => <span key={s}>{s}{i < seq.length - 1 ? " →" : ""}</span>)}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button style={pBtnGhost} onClick={() => { setSeq([]); setCorrect(null); }} disabled={locked}>Reset</button>
        <button style={pBtn} onClick={check} disabled={locked || seq.length !== items.length}>Check</button>
      </div>
      <Feedback correct={correct} />
    </div>
  );
}
