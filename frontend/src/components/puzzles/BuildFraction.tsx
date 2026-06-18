import { useState } from "react";
import { Stage, Layer, Rect } from "react-konva";
import type { InteractivePuzzleProps } from "./types";
import { pBtn, pBtnGhost, Feedback } from "./ui";

export default function BuildFraction({ payload, onSolved, disabled }: InteractivePuzzleProps) {
  const total = Math.max(2, Number(payload.params.total) || 4);
  const target = Math.min(total, Number(payload.params.target_num) || 1);
  const [shaded, setShaded] = useState<boolean[]>(() => Array(total).fill(false));
  const [correct, setCorrect] = useState<boolean | null>(null);

  const W = 380, H = 90, cw = W / total;
  const count = shaded.filter(Boolean).length;
  const locked = disabled || correct === true;

  const toggle = (i: number) => {
    if (locked) return;
    setShaded((s) => s.map((v, j) => (j === i ? !v : v)));
    setCorrect(null);
  };
  const check = () => {
    const ok = count === target;
    setCorrect(ok);
    onSolved(`${count}/${total}`, ok);
  };

  return (
    <div style={{ textAlign: "center" }}>
      <Stage width={W} height={H} style={{ margin: "0 auto" }}>
        <Layer>
          {Array.from({ length: total }).map((_, i) => (
            <Rect
              key={i} x={i * cw + 1} y={10} width={cw - 2} height={H - 20}
              fill={shaded[i] ? "#7c3aed" : "#f1f5f9"} stroke="#94a3b8" strokeWidth={1.5}
              cornerRadius={3} onClick={() => toggle(i)} onTap={() => toggle(i)}
            />
          ))}
        </Layer>
      </Stage>
      <p style={{ fontSize: 13, color: "#64748b", margin: "8px 0" }}>
        Target: <strong>{target}/{total}</strong> · Shaded: <strong>{count}/{total}</strong> — tap parts to shade them.
      </p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button style={pBtnGhost} onClick={() => { setShaded(Array(total).fill(false)); setCorrect(null); }} disabled={locked}>Reset</button>
        <button style={pBtn} onClick={check} disabled={locked}>Check</button>
      </div>
      <Feedback correct={correct} />
    </div>
  );
}
